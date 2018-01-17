const Mongolass = require('mongolass')
const mongolass = new Mongolass('mongodb://localhost:27017/test')
const User = mongolass.model('User')
const Post = mongolass.model('Post')
const Comment = mongolass.model('Comment')

exports.createUser = function * () {
  const name = this.query.name || 'default'
  const age = +this.query.age || 18
  yield createUser(name, age)
  this.status = 204
}

function * createUser (name, age) {
  const user = (yield User.create({
    name,
    age
  })).ops[0]
  yield createPost(user)
}

function * createPost (user) {
  const post = (yield Post.create({
    uid: user._id,
    title: 'post',
    content: 'post'
  })).ops[0]

  yield createComment(user, post)
}

function * createComment (user, post) {
  yield Comment.create({
    userId: user._id,
    postId: post._id,
    content: 'comment'
  })
}
