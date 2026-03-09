'use strict'

module.exports = (ndx) ->
  decorate = (args, cb) ->
    if args.obj and args.obj.deleted
      return cb true
    switch args.table
      when 'users', 'issues', 'contractors'
        cb true
      else
        cb true
  ndx.decorator = {}
  setImmediate ->
    ndx.database.on 'preInsert', decorate
    ndx.database.on 'preUpdate', decorate