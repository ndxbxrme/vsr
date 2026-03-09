'use strict'

require 'ndx-server'
.config
  database: 'db'
  tables: ['users', 'properties', 'progressions', 'emailtemplates', 'smstemplates', 'dashboard', 'targets', 'shorttoken', 'clientmanagement']
  localStorage: './data'
  hasInvite: true
  hasForgot: true
  serveUploads: true
  softDelete: true
  publicUser:
    _id: true
    displayName: true
    local:
      email: true
    roles: true
.start()
