'use strict'
settings = require './settings.js'
chalk = require 'chalk'
underscored = require 'underscore.string'
.underscored
glob = require 'glob'
fs = require 'fs'
rfs = require 'rotating-file-stream'
cluster = require 'cluster'
cryptojs = require 'crypto-js'


configured = false
controllers = []
uselist = []
middleware = []
module.exports =
  config: (config) ->
    for key of config
      keyU = underscored(key).toUpperCase()
      if Object.prototype.toString.call(config[key]) is '[object Boolean]'
        settings[keyU] = config[key]
      else
        settings[keyU] =  settings[keyU] or config[key]
    if not settings.DB_ENGINE
      settings.DB_ENGINE = require 'ndxdb'
    if settings.TABLES and settings.TABLES.length
      if settings.TABLES.indexOf(settings.USER_TABLE) is -1
        settings.TABLES.push settings.USER_TABLE
    else
      settings.TABLES = [settings.USER_TABLE]
    configured = true
    @
  controller: (ctrl) ->
    type = Object.prototype.toString.call ctrl
    if type is '[object Function]'
      controllers.push ctrl
    else
      controllers.push require('../../' + ctrl)
    @
  use: (ctrl) ->
    type = Object.prototype.toString.call ctrl
    if type is '[object Function]'
      uselist.push ctrl
    else
      uselist.push require('../../' + ctrl)
    @
  start: ->
    if cluster.isMaster
      i = 0
      while i++ < 1
        cluster.fork()
      cluster.on 'exit', (worker) ->
        console.log "Worker #{worker.id} died.."
        if settings.AUTO_RESTART and settings.AUTO_RESTART.toString().toLowerCase() isnt 'false'
          cluster.fork()
        else
          process.exit 1
    else
      console.log "\nndx server starting"
      if not configured
        @config()
      ndx = require './services/ndx'
      ndx.database = settings.DB_ENGINE
      .config settings
      .setNdx ndx
      .start()
      ndx.cookieName = (settings.APP_NAME or '') + 'token'
      express = require 'express'
      compression = require 'compression'
      bodyParser = require 'body-parser'
      cookieParser = require 'cookie-parser'
      session = require 'express-session'
      MemoryStore = require('session-memory-store') session
      http = require 'http'
      if settings.SSL_PORT
        https = require 'https'
      helmet = require 'helmet'
      morgan = require 'morgan'
      maintenance = require './maintenance.js'
      ndx.app = express()
      ndx.static = express.static
      ndx.port = settings.PORT
      ndx.ssl_port = settings.SSL_PORT
      ndx.host = settings.HOST
      ndx.settings = settings
      ndx.app.use compression()
      .use helmet()
      if not ndx.settings.DO_NOT_LOG
        if ndx.settings.LOG_TO_SCREEN
          ndx.app.use morgan ndx.settings.LOG_LEVEL
        else
          fs.existsSync(ndx.settings.LOG_DIR) or fs.mkdirSync(ndx.settings.LOG_DIR)
          accessLogStream = rfs 'access.log',
            interval: '1d'
            path: ndx.settings.LOG_DIR
          ndx.app.use morgan ndx.settings.LOG_LEVEL,
            stream: accessLogStream
      ndx.app.use maintenance
        database: ndx.database
      .use session
        name: 'session'
        secret: ndx.settings.SESSION_SECRET
        saveUninitialized: true
        resave: true
        store: new MemoryStore
          expires: 5
      .use cookieParser ndx.settings.SESSION_SECRET
      if ndx.settings.E2E_ENCRYPTION
        ndx.app.use (req, res, next) ->
          if req.headers['content-type'] and req.headers['content-type'].indexOf('application/json') is 0
            bodyParser.text({type:'*/*',limit:'50mb'})(req, res, next)
          else
            bodyParser.json({limit:'50mb'})(req, res, next)
        .use (req, res, next) ->
          if req.headers['content-type'] and req.headers['content-type'].indexOf('application/json') is 0
            if ndx.crypto
              ndx.crypto.decrypt req
          next()
        ndx.app.use (req, res, next) ->
          if ndx.crypto
            ndx.crypto.encrypt res
          next()
      else
        ndx.app.use bodyParser.json
          limit: '50mb'
      ndx.server = http.createServer ndx.app
      if settings.SSL_PORT
        ndx.sslserver = https.createServer 
          key: fs.readFileSync 'key.pem'
          cert: fs.readFileSync 'cert.pem'
        , ndx.app
      require('./controllers/token') ndx
      modulesToLoad = []
      if settings.AUTO_LOAD_MODULES
        r = glob.sync "server/startup/**/*.js"
        r.reverse()
        for module in r
          require("#{process.cwd()}/#{module}") ndx
        r = glob.sync 'node_modules/*'
        for module in r
          moduleName = module.replace('node_modules/', '')
          modulePackage = {}
          try
            modulePackage = require("#{process.cwd()}/node_modules/#{moduleName}/package.json")
          catch e
          if (moduleName.indexOf('ndx-') is 0 or modulePackage.ndx) and not modulePackage.ndxIgnore
            if moduleName isnt 'ndx-server' and modulePackage.loadOrder isnt 'ignore'
              modulesToLoad.push
                name: moduleName
                loadOrder: if Object.prototype.toString.call(modulePackage.loadOrder) is '[object Number]' then modulePackage.loadOrder else 5
                version: modulePackage.version
          modulePackage = null
        modulesToLoad.sort (a, b) ->
          a.loadOrder - b.loadOrder
        console.log ''
        w = (text) ->
          i = text.length
          while i++ < 20
            text += ' '
          text
        for module in modulesToLoad
          #console.log "loading #{module.name}"
          require("../../#{module.name}") ndx
          console.log "#{w(module.name)}\t#{module.version}"
        for folder in ['services', 'controllers']
          r = glob.sync "server/#{folder}/**/*.js"
          r.reverse()
          for module in r
            #console.log "loading #{module}"
            try
              require("#{process.cwd()}/#{module}") ndx
            catch e
      for useCtrl in uselist
        useCtrl ndx
      for ctrl in controllers
        ctrl ndx

      ndx.UNAUTHORIZED =
        status: 401
        message: 'Not authorized'

      setImmediate ->
        ndx.app.use (err, req, res, next) ->
          message = ''
          if err.hasOwnProperty 'message'
            message = err.message
          else
            message = err.toString()
          if Object.prototype.toString.call message is '[object Object]'
            res.status(err.status or 500).json message
          else
            res.status(err.status or 500).send message
      ###  
      process.on 'uncaughtException', (err) ->
        console.log 'uncaughtException'
        console.log err
        process.exit 1
      ###
      ndx.server.listen ndx.port, ->
        console.log chalk.yellow "#{ndx.logo}ndx server v#{chalk.cyan.bold(ndx.version)} listening on #{chalk.cyan.bold(ndx.port)}"
        console.log chalk.yellow "started: #{new Date().toLocaleString()}"
      if settings.SSL_PORT
        ndx.sslserver.listen ndx.ssl_port, ->
          console.log chalk.yellow "ndx ssl server v#{chalk.cyan.bold(ndx.version)} listening on #{chalk.cyan.bold(ndx.ssl_port)}"

if global.gc
  setInterval ->
    global.gc?()
  , 2 * 60 * 1000