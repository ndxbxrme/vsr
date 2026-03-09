'use strict'

module.exports = (ndx) ->
  sendEmail = (args, cb) ->
    if args.table is 'tasks' and args.obj
      ndx.database.select 'users',
        _id: args.obj.assignedTo
      , (users) ->
        if users and users.length
          console.log users[0]
    cb? true
  ndx.database.on 'insert', sendEmail
  ndx.database.on 'update', sendEmail