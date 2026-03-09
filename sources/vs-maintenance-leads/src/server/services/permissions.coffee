'use strict'

module.exports = (ndx) ->
  select = (args, cb) ->
    cb true
  update = (args, cb) ->
    cb true
  ndx.database.permissions.set
    all:
      update: update
      insert: update
      delete: update
      select: select
  ndx.rest.permissions.set
    all:
      update: update
      insert: update
      delete: update
      select: select