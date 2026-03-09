'use strict'

ndx = require '../index.js'
.config
  appName: 'testApp'
  database: 'rb'
  tables: ['users', 'tasks']
  port: 23000
  logToScreen: true
.controller (ndx) ->
  ndx.database.on 'ready', ->
    console.log ndx.database.getDb().users.data.length
.use (ndx) ->
  data =
    name: 'bobby'
    age: 23
  console.log data
  console.log ndx.generateID()
  ndx.app.use '/api/something', (req, res, next) ->
    res.end '<html><body><h1>test</h1></body></html>'
.start()
