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
