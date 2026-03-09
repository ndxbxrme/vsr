'use strict'
 
ndx = require 'ndx-server'
.config
  database: 'vs'
  tables: ['users', 'props', 'tmpprops']
  localStorage: './data'
  maxSqlCacheSize: 50
  publicUser:
    _id: true
    local: true
    dezrez:
      Id: true
      ContactName: true
    roles: true
  restTables: ['users']
.use (ndx) ->
  if process.env.REZI_ID and process.env.REZI_SECRET and process.env.AGENCY_ID and process.env.API_URL and process.env.API_KEY
    true
  else
    console.log '*****************************'
    console.log 'ENVIRONMENT VARIABLES NOT SET'
    console.log '*****************************'
.use (ndx) ->
  ndx.database.permissions.set
    users:
      select: ['superadmin','admin', (args,cb) ->
        if args.objs and args.user
          i = args.objs.length
          while i-- > 0
            if args.objs[i]._id isnt args.user._id
              args.objs.splice i, 1
        cb true
      ]
      all: ['superadmin', 'admin', (args, cb) ->
        if args.user and args.where
          return cb (args.user._id is args.where._id)
        return true
      ]
.use (ndx) ->
  ndx.passport.on 'login', (obj) ->
    ndx.database.update 'users',
      lastLogin: new Date().valueOf()
    ,
      _id: obj._id
  ndx.passport.on 'refreshLogin', (obj) ->
    ndx.database.update 'users',
      lastRefresh: new Date().valueOf()
    ,
      _id: obj._id
.controller (ndx) ->
  ndx.app.use '/wp-content/themes/VitalSpace2015/public/img/int/icons', ndx.static('./public/img/icons')
.start()