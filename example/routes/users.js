const User = require('../models/users')

exports.createUser = function * createUser () {
  const name = this.query.name || 'default'
  const age = +this.query.age || 18
  yield User.createUser(name, age)
  this.status = 204
}
