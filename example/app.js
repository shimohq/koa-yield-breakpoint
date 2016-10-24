'use strict';

const koaYieldBreakpoint = require('..')({
  files: ['./routes/*.js']
});

const koa = require('koa');
const routes = require('./routes');
const app = koa();

app.use(koaYieldBreakpoint);

routes(app);

app.listen(3000, () => {
  console.log('listening on 3000');
});
