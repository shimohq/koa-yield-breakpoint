const asyncIdMap = new Map()
const sourceMap = new Map()
require('source-map-support').install({
  retrieveSourceMap: (source) => {
    const sourcemap = sourceMap.get(source)
    if (sourcemap) {
      return {
        url: source,
        map: sourcemap,
        environment: 'node'
      }
    }
    return null
  }
})

const assert = require('assert')
const Module = require('module')
const async_hooks = require('async_hooks')

const _ = require('lodash')
const glob = require('glob')
const uuid = require('node-uuid')
const esprima = require('esprima')
const shimmer = require('shimmer')
const escodegen = require('escodegen')
const debug = require('debug')('koa-yield-breakpoint')

async_hooks.createHook({
  init (asyncId, type, triggerAsyncId) {
    const ctx = getCtx(triggerAsyncId)
    if (ctx) {
      asyncIdMap.set(asyncId, ctx)
    } else {
      asyncIdMap.set(asyncId, triggerAsyncId)
    }
  },
  destroy (asyncId) {
    asyncIdMap.delete(asyncId)
  }
}).enable()

const defaultOpt = {
  sourcemap: true,
  nodir: true,
  absolute: true,
  filter: {
    ctx: ['state', 'params'],
    request: ['method', 'path', 'header', 'query', 'body'],
    response: ['status', 'body']
  },
  loggerName: 'logger',
  requestIdPath: 'requestId'
}

module.exports = function (opt) {
  opt = _.defaults(opt || {}, defaultOpt)
  opt.filter = opt.filter || {}
  opt.filter.ctx = opt.filter.ctx || defaultOpt.filter.ctx
  opt.filter.request = opt.filter.request || defaultOpt.filter.request
  opt.filter.response = opt.filter.response || defaultOpt.filter.response
  debug('options: %j', opt)

  const name = opt.name
  const loggerName = opt.loggerName
  const requestIdPath = opt.requestIdPath
  const files = opt.files
  const exclude_files = opt.exclude_files || []
  const store = opt.store || { save: (record) => console.log('%j', record) }
  const yieldCondition = opt.yieldCondition
  const sourcemap = opt.sourcemap
  assert(requestIdPath && _.isString(requestIdPath), '`requestIdPath` option must be string')
  assert(files && _.isArray(files), '`files`{array} option required')
  assert(_.isArray(exclude_files), '`exclude_files`{array} option required')
  assert(store && _.isFunction(store.save), '`store.save`{function} option required, see: koa-yield-breakpoint-mongodb')
  if (yieldCondition) {
    assert(_.isFunction(yieldCondition), '`yieldCondition` option must be function')
  }

  // add global logger
  global[loggerName] = function * (ctx, fn, fnStr, filename) {
    const originalContext = ctx
    let requestId = _getRequestId()

    const asyncId = async_hooks.executionAsyncId()
    if (!requestId) {
      const _ctx = getCtx(asyncId)
      if (_ctx) {
        ctx = _ctx
        requestId = _getRequestId()
      }
    } else {
      asyncIdMap.set(asyncId, ctx)
    }

    let prevRecord
    if (requestId) {
      prevRecord = _logger('beforeYield')
    }
    let result
    try {
      result = yield * fn.call(originalContext)
    } catch (e) {
      // use innermost error info
      e._fn = e._fn || fnStr
      e._filename = e._filename || filename
      throw e
    }
    if (requestId) {
      _logger('afterYield', result, prevRecord && prevRecord.timestamp)
    }
    return result

    function _getRequestId () {
      return ctx && ctx.app && _.get(ctx, requestIdPath)
    }

    function _logger (type, result, prevTimestamp) {
      const _this = _.pick(ctx, opt.filter.ctx)
      _this.request = _.pick(ctx.request, opt.filter.request)
      _this.response = _.pick(ctx.response, opt.filter.response)

      const record = {
        name,
        requestId,
        step: ++ctx.step,
        filename,
        timestamp: new Date(),
        this: _this,
        type,
        fn: fnStr,
        result
      }
      addTake(ctx, record, prevTimestamp)
      debug(record)

      store.save(record, ctx)
      return record
    }
  }

  let filenames = []
  files.forEach(filePattern => {
    if (filePattern) {
      filenames = filenames.concat(glob.sync(filePattern, opt))
    }
  })
  exclude_files.forEach(filePattern => {
    if (filePattern) {
      _.pullAll(filenames, glob.sync(filePattern, opt))
    }
  })
  filenames = _.uniq(filenames)
  debug('matched files: %j', filenames)

  // wrap Module.prototype._compile
  shimmer.wrap(Module.prototype, '_compile', function (__compile) {
    return function koaBreakpointCompile (content, filename) {
      if (!_.includes(filenames, filename)) {
        try {
          return __compile.call(this, content, filename)
        } catch (e) {
          // `try { require('...') } catch (e) { ... }` will not print compile error message
          debug('cannot compile file: %s', filename)
          debug(e.stack)
          throw e
        }
      }

      let parsedCodes
      try {
        parsedCodes = esprima.parse(content, { loc: true })
      } catch (e) {
        console.error('cannot parse file: %s', filename)
        console.error(e.stack)
        process.exit(1)
      }

      findYieldAndWrapLogger(parsedCodes)
      try {
        content = escodegen.generate(parsedCodes, {
          format: { indent: { style: '  ' } },
          sourceMap: filename,
          sourceMapWithCode: true
        })
      } catch (e) {
        console.error('cannot generate code for file: %s', filename)
        console.error(e.stack)
        process.exit(1)
      }
      debug('file %s regenerate codes:\n%s', filename, content.code)

      // add to sourcemap cache
      if (sourcemap) {
        sourceMap.set(filename, content.map.toString())
      }
      return __compile.call(this, content.code, filename)

      function findYieldAndWrapLogger (node) {
        if (!node || typeof node !== 'object') {
          return
        }
        let condition = {
          wrapYield: true,
          deep: true
        }

        if (node.hasOwnProperty('type') && node.type === 'YieldExpression' && !node.__skip) {
          const codeLine = node.loc.start
          const __argument = node.argument
          const __expressionStr = escodegen.generate(__argument)
          const expressionStr = `
            global.${loggerName}(
              this,
              function*(){
                return yield ${__expressionStr}
              },
              ${JSON.stringify(__expressionStr)},
              ${JSON.stringify(filename + ':' + codeLine.line + ':' + codeLine.column)}
            )`

          if (yieldCondition) {
            condition = yieldCondition(filename, __expressionStr, __argument) || condition
            assert(typeof condition === 'object', '`yieldCondition` must return a object')
          }
          if (condition.wrapYield) {
            try {
              node.argument = esprima.parse(expressionStr, { loc: true }).body[0].expression
              node.delegate = true
              try {
                // skip process this YieldExpression
                node.argument.arguments[1].body.body[0].argument.__skip = true
                // try correct loc
                node.argument.arguments[1].body.body[0].argument.argument = __argument
              } catch (e) { /* ignore */ }
            } catch (e) {
              console.error('cannot parse expression:')
              console.error(expressionStr)
              console.error(e.stack)
              process.exit(1)
            }
          }
        }
        if (condition.deep) {
          for (const key in node) {
            if (node.hasOwnProperty(key)) {
              findYieldAndWrapLogger(node[key])
            }
          }
        }
      }
    }
  })

  return function * koaYieldBreakpoint (next) {
    if (!_.get(this, requestIdPath)) {
      _.set(this, requestIdPath, uuid.v4())
    }
    this.step = 0
    this.timestamps = {}

    _logger(this, 'start')
    try {
      yield next
    } catch (e) {
      _logger(this, 'error', e)
      throw e
    } finally {
      _logger(this, 'end')
    }

    function _logger (ctx, type, err) {
      const _this = _.pick(ctx, opt.filter.ctx)
      _this.request = _.pick(ctx.request, opt.filter.request)
      _this.response = _.pick(ctx.response, opt.filter.response)

      const record = {
        name,
        requestId: _.get(ctx, requestIdPath),
        timestamp: new Date(),
        this: _this,
        type,
        step: ++ctx.step
      }
      if (err) {
        record.error = err
        record.fn = err._fn
        record.filename = err._filename
        delete err._fn
        delete err._filename
      }
      addTake(ctx, record)
      debug(record)

      store.save(record, ctx)
    }
  }
}

function addTake (ctx, record, prevTimestamp) {
  ctx.timestamps[record.step] = record.timestamp
  prevTimestamp = prevTimestamp || ctx.timestamps[record.step - 1]
  if (prevTimestamp) {
    record.take = record.timestamp - prevTimestamp
  } else {
    // start default 0
    record.take = 0
  }
}

function getCtx (asyncId) {
  if (!asyncId) {
    return
  }
  if (typeof asyncId === 'object' && asyncId.app) {
    return asyncId
  }
  return getCtx(asyncIdMap.get(asyncId))
}
