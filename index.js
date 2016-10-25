'use strict';

const sourceMapCache = {};
require('source-map-support').install({
  retrieveSourceMap: (source) => {
    const sourcemap = sourceMapCache[source];
    if (sourcemap) {
      return {
        map: sourcemap
      };
    }
    return null;
  }
});

const assert = require('assert');
const Module = require('module');

const _ = require('lodash');
const glob = require('glob');
const uuid = require('node-uuid');
const esprima = require('esprima');
const shimmer = require('shimmer');
const escodegen = require('escodegen');
const isGenerator = require('is-generator');
const debug = require('debug')('koa-yield-breakpoint');

const defaultOpt = {
  nodir: true,
  absolute: true,
  filter: {
    ctx: ['state', 'params'],
    request: ['method', 'path', 'header', 'query', 'body'],
    response: ['status', 'body']
  },
  loggerName: 'logger'
};

module.exports = function (opt) {
  opt = _.defaults(opt || {}, defaultOpt);
  opt.filter = opt.filter || {};
  opt.filter.ctx = opt.filter.ctx || defaultOpt.filter.ctx;
  opt.filter.request = opt.filter.request || defaultOpt.filter.request;
  opt.filter.response = opt.filter.response || defaultOpt.filter.response;
  debug('options: %j', opt);

  const loggerName = opt.loggerName;
  const files = opt.files;
  const store = opt.store || { save: (record) => console.log(record) };
  assert(files && _.isArray(files), '`files`{array} option required');
  assert(store && _.isFunction(store.save), '`store.save`{function} option required, see: koa-yield-breakpoint-mongodb');

  // add global logger
  global[loggerName] = function *(ctx, fn, fnStr, filename) {
    const requestId = ctx && ctx.requestId;
    if (requestId) {
      _logger('before');
    }
    let result = yield fn;
    if (isGenerator(result)) {
      result = yield result;
    }
    if (requestId) {
      _logger('after', result);
    }
    return result;

    function _logger(type, result) {
      const _this = _.pick(ctx, opt.filter.ctx);
      _this.request = _.pick(ctx.request, opt.filter.request);
      _this.response = _.pick(ctx.response, opt.filter.response);

      const record = {
        requestId,
        step: ++ctx.step,
        filename,
        timestamp: new Date(),
        this: _this,
        type,
        fn: fnStr,
        result
      };
      debug(record);
      store.save(record);
    }
  };

  let filenames = [];
  files.forEach(filePattern => {
    filenames = filenames.concat(glob.sync(filePattern, opt));
  });
  filenames = _.uniq(filenames);
  debug('matched files: %j', filenames);

  // wrap Module.prototype._compile
  shimmer.wrap(Module.prototype, '_compile', function (__compile) {
    return function koaBreakpointCompile(content, filename) {
      if (!_.includes(filenames, filename)) {
        return __compile.call(this, content, filename);
      }

      let parsedCodes;
      try {
        parsedCodes = esprima.parse(content, { loc: true });
      } catch (e) {
        console.error('cannot parse file: %s', filename);
        console.error(e.stack);
        process.exit(1);
      }

      findTypeAndAddLogger(parsedCodes, 'YieldExpression');
      try {
        content = escodegen.generate(parsedCodes, {
          format: { indent: { style: '  ' } },
          sourceMap: filename,
          sourceMapWithCode: true
        });
      } catch (e) {
        console.error('cannot generate code for file: %s', filename);
        console.error(e.stack);
        process.exit(1);
      }
      debug('file %s regenerate codes:\n%s', filename, content.code);

      // add to sourcemap cache
      sourceMapCache[filename] = content.map.toString();
      return __compile.call(this, content.code, filename);

      function findTypeAndAddLogger(node, type) {
        if (!node || typeof node !== 'object') {
          return;
        }
        if (node.hasOwnProperty('type') && node.type === type) {
          const codeLine = node.loc.start;
          const __argument = node.argument;

          let expressionStr = escodegen.generate(__argument);
          expressionStr = `
            global.${loggerName}(
              this,
              (function*(){
                return ${expressionStr}
              }).call(this),
              ${JSON.stringify(expressionStr)},
              ${JSON.stringify(filename + ':' + codeLine.line + ':' + codeLine.column)}
            )`;
          try {
            node.argument = esprima.parse(expressionStr, { loc: true }).body[0].expression;
            try {
              // try correct loc
              node.argument.arguments[1].callee.object.body.body[0].argument = __argument;
            } catch (e) {/* empty */}
          } catch (e) {
            console.error('cannot parse expression:');
            console.error(expressionStr);
            console.error(e.stack);
            process.exit(1);
          }
        }
        for (const key in node) {
          if (node.hasOwnProperty(key)) {
            findTypeAndAddLogger(node[key], type);
          }
        }
      }
    };
  });

  return function *koaYieldBreakpoint(next) {
    if (!this.requestId) {
      this.requestId = uuid.v4();
    }
    this.step = 0;

    _logger(this, 'start');
    yield next;
    _logger(this, 'end');

    function _logger(ctx, type) {
      const _this = _.pick(ctx, opt.filter.ctx);
      _this.request = _.pick(ctx.request, opt.filter.request);
      _this.response = _.pick(ctx.response, opt.filter.response);

      const record = {
        requestId: ctx.requestId,
        timestamp: new Date(),
        this: _this,
        type,
        step: ++ctx.step
      };

      debug(record);
      store.save(record);
    }
  };
};
