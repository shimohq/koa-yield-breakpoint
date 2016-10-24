'use strict';

const route = require('koa-route');
const users = require('./users');

module.exports = function (app) {
  app.use(route.get('/users', users.getUsers));
};
