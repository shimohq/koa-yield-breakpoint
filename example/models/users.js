const Mongolass = require('mongolass')
const mongolass = new Mongolass('mongodb://localhost:27017/test')
const User = mongolass.model('User')
const Post = mongolass.model('Post')
const Comment = mongolass.model('Comment')

module.exports = {
  * createUser (name, age) {
    yield createUser(name, age)
  }
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
