'use strict'

require 'ndx-server'
.config
  database: 'db'
  tables: ['users', 'tasks', 'jobtypes']
  localStorage: './data'
  hasInvite: true
  hasForgot: true
  serveUploads: true
  publicUser:
    _id: true
    displayName: true
    local:
      email: true
    roles: true
.use (ndx) ->
  ndx.database.on 'ready', ->
    count = ndx.database.count 'jobtypes'
    if count is 0
      ndx.database.insert 'jobtypes',
        type: 'default',
        jobs: 'Cleaning\nPainting'
.start()
