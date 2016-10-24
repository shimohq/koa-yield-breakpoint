## koa-yield-breakpoint

Add breakpoints around `yield` expression especially for koa@1.

### Example

```
cd example && DEBUG=koa-yield-breakpoint node app
```

**app.js**

```
'use strict';

const koaYieldBreakpoint = require('koa-yield-breakpoint')({
  files: ['./routes/*.js'],
  // store: new require('koa-yield-breakpoint-mongodb')({
  //   url: 'mongodb://localhost:27017/test',
  //   coll: 'koa-yield-breakpoint-loggers'
  // })
});

const koa = require('koa');
const routes = require('./routes');
const app = koa();

app.use(koaYieldBreakpoint);

routes(app);

app.listen(3000, () => {
  console.log('listening on 3000');
});
```

**NB**: You'd better put `require('koa-yield-breakpoint')` on the top of main file, because `koa-yield-breakpoint` rewrite `Module.prototype._compile`.

**routes/users.js**

```
'use strict';

const Mongolass = require('mongolass');
const mongolass = new Mongolass();
mongolass.connect('mongodb://localhost:27017/test');

exports.getUsers = function* getUsers() {
  yield mongolass.model('users').create({
    name: 'xx',
    age: 18
  });

  const users = yield mongolass.model('users').find();
  this.body = users;
};
```

After added breakpoints:

```
'use strict';
const Mongolass = require('mongolass');
const mongolass = new Mongolass();
mongolass.connect('mongodb://localhost:27017/test');
exports.getUsers = function* getUsers() {
  yield global.logger(this, function* () {
    return mongolass.model('users').create({
      name: 'xx',
      age: 18
    });
  }.call(this), 'mongolass.model(\'users\').create({\n    name: \'xx\',\n    age: 18\n})', '/Users/nswbmw/node/koa-yield-breakpoint/example/routes/users.js:8:2');
  const users = yield global.logger(this, function* () {
    return mongolass.model('users').find();
  }.call(this), 'mongolass.model(\'users\').find()', '/Users/nswbmw/node/koa-yield-breakpoint/example/routes/users.js:13:16');
  this.body = users;
};
```

As you see, koa-yield-breakpoint wrap `YieldExpression` with:

```
global.logger(
  this,
  (function*(){
    return YieldExpression
  }).call(this),
  YieldExpressionString,
  filename
);
```

when access `localhost:3000/users` in browser, the console print:

```
{ requestId: '62cfc959-6302-4e99-b237-1f91cb2d1eaf',
  timestamp: Sun Oct 23 2016 22:57:06 GMT+0800 (CST),
  this:
   { state: {},
     request:
      { method: 'GET',
        path: '/users',
        header: [Object],
        query: [Object] },
     response: { status: 404, body: undefined } },
  type: 'start',
  step: 1 }
{ requestId: '62cfc959-6302-4e99-b237-1f91cb2d1eaf',
  step: 2,
  filename: '/Users/nswbmw/node/koa-yield-breakpoint/example/routes/users.js:8:2',
  timestamp: Sun Oct 23 2016 22:57:06 GMT+0800 (CST),
  this:
   { state: {},
     request:
      { method: 'GET',
        path: '/users',
        header: [Object],
        query: [Object] },
     response: { status: 404, body: undefined } },
  type: 'before',
  fn: 'mongolass.model(\'users\').create({\n    name: \'xx\',\n    age: 18\n})',
  result: undefined }
{ requestId: '62cfc959-6302-4e99-b237-1f91cb2d1eaf',
  step: 3,
  filename: '/Users/nswbmw/node/koa-yield-breakpoint/example/routes/users.js:8:2',
  timestamp: Sun Oct 23 2016 22:57:06 GMT+0800 (CST),
  this:
   { state: {},
     request:
      { method: 'GET',
        path: '/users',
        header: [Object],
        query: [Object] },
     response: { status: 404, body: undefined } },
  type: 'after',
  fn: 'mongolass.model(\'users\').create({\n    name: \'xx\',\n    age: 18\n})',
  result:
   { result: { ok: 1, n: 1 },
     ops: [ [Object] ],
     insertedCount: 1,
     insertedIds: [ , 580ccfc2f467ee572368eade ] } }
{ requestId: '62cfc959-6302-4e99-b237-1f91cb2d1eaf',
  step: 4,
  filename: '/Users/nswbmw/node/koa-yield-breakpoint/example/routes/users.js:13:16',
  timestamp: Sun Oct 23 2016 22:57:06 GMT+0800 (CST),
  this:
   { state: {},
     request:
      { method: 'GET',
        path: '/users',
        header: [Object],
        query: [Object] },
     response: { status: 404, body: undefined } },
  type: 'before',
  fn: 'mongolass.model(\'users\').find()',
  result: undefined }
{ requestId: '62cfc959-6302-4e99-b237-1f91cb2d1eaf',
  step: 5,
  filename: '/Users/nswbmw/node/koa-yield-breakpoint/example/routes/users.js:13:16',
  timestamp: Sun Oct 23 2016 22:57:06 GMT+0800 (CST),
  this:
   { state: {},
     request:
      { method: 'GET',
        path: '/users',
        header: [Object],
        query: [Object] },
     response: { status: 404, body: undefined } },
  type: 'after',
  fn: 'mongolass.model(\'users\').find()',
  result: [ { _id: 580ccfc2f467ee572368eade, name: 'xx', age: 18 } ] }
{ requestId: '62cfc959-6302-4e99-b237-1f91cb2d1eaf',
  timestamp: Sun Oct 23 2016 22:57:06 GMT+0800 (CST),
  this:
   { state: {},
     request:
      { method: 'GET',
        path: '/users',
        header: [Object],
        query: [Object] },
     response: { status: 200, body: [Object] } },
  type: 'end',
  step: 6 }
```

koa-yield-breakpoint will print to console by default, if you want to save these logs to db, set `store` option, eg: [koa-yield-breakpoint-mongodb](https://github.com/nswbmw/koa-yield-breakpoint-mongodb).

### Options

require('koa-yield-breakpoint')(option)

- files{String[]}: files pattern, see [glob](https://github.com/isaacs/node-glob), required.
- store{Object}: backend store instance, see [koa-yield-breakpoint-mongodb](https://github.com/nswbmw/koa-yield-breakpoint-mongodb), default print to console.
- filter{Object}: reserved field in koa's `this`, default:
```
{
  ctx: ['state', 'params'],
  request: ['method', 'path', 'header', 'query', 'body'],
  response: ['status', 'body']
}
```
- loggerName{String}: global logger name, default `logger`.
- others: see [glob](https://github.com/isaacs/node-glob#options).
