'use strict'
async = require 'async'

module.exports = (ndx) ->
  if process.env.REZI_ID and process.env.REZI_SECRET
    pageSize = 
      pageSize:2000
    updateUserDezrez = (dezrez, userId) ->
      ndx.database.exec 'UPDATE ' + ndx.settings.USER_TABLE + ' SET dezrez=? WHERE _id=?', [
        dezrez
        userId
      ]
    findByEmail = (email, userId, callback) ->
      ndx.dezrez.get 'people/findbyemail', 
        emailAddress:email
      , (err, body) ->
        if not err and body and body.length
          if body.length is 1
            updateUserDezrez body[0], userId
          callback body
        else
          callback error:'error'
    ndx.authorizeDezrez = (req, res, next) ->
      if ndx.user and ndx.user.dezrez
        next()
      else
        throw ndx.UNAUTHORIZED
      
    ndx.app.post '/api/dezrez/update-user-props', ndx.authenticate(), (req, res) ->
      ndx.database.update 'users',
        properties: req.body.properties
      ,
        _id: ndx.user._id
      res.end 'ok'
    ndx.app.post '/api/dezrez/email', ndx.authenticate(),  (req, res) ->
      email = req.body.email or ndx.user.local?.email or ndx.user.facebook?.email
      findByEmail email, ndx.user._id, (data) ->
        res.json data
    ndx.app.post '/api/dezrez/findbyemail', ndx.authenticate(), (req, res) ->
      email = req.body.email or ndx.user.local?.email or ndx.user.facebook?.email
      findByEmail email, ndx.user._id, (data) ->
        res.json data
    ndx.app.post '/api/dezrez/update', ndx.authenticate(), (req, res) ->
      updateUserDezrez req.body.dezrez, ndx.user._id
      res.end 'OK'
    ndx.app.get '/api/dezrez/property/:id', ndx.authenticate(), (req, res, next) ->
      ndx.dezrez.get 'property/{id}', null, id:req.params.id, (err, body) ->
        if not err
          res.json body
        else
          next err
    ndx.app.get '/api/dezrez/rightmove/:id', ndx.authenticate(), (req, res, next) ->
      ndx.dezrez.get 'stats/rightmove/{id}', null, id:req.params.id, (err, body) ->
        console.log 'rightmove', err, body
        if not err
          res.json body
        else
          next err 
    ndx.app.get '/api/dezrez/portals/:id', ndx.authenticate(), (req, res, next) ->
      ndx.dezrez.get 'stats/portals/{id}', null, id:req.params.id, (err, body) ->
        if not err
          res.json body
        else
          next err 
    ndx.app.get '/api/dezrez/property/:id/events', ndx.authorizeDezrez, (req, res, next) ->
      ndx.dezrez.get 'role/{id}/Events', pageSize, id:req.params.id, (err, body) ->
        if not err
          res.json body
        else
          next err
    ndx.app.get '/api/dezrez/property/:id/mailouts', ndx.authorizeDezrez, (req, res, next) ->
      ndx.dezrez.get 'role/{id}/mailouts', pageSize, id:req.params.id, (err, body) ->
        if not err
          res.json body
        else
          next err
    ndx.app.get '/api/dezrez/property/list/:type', ndx.authorizeDezrez, (req, res, next) ->
      type = req.params.type
      ndx.dezrez.get 'people/{id}/' + type, pageSize, id:ndx.user.dezrez.Id, (err, body) ->
        console.log 'LIST', err, body
        if not err
          res.json body
        else
          next err
    ndx.app.get '/api/dezrez/role/:type', ndx.authorizeDezrez, (req, res) ->
      type = req.params.type
      roleIds = []
      items = []
      async.each ['selling'], (status, callback) ->
        ndx.dezrez.get 'people/{id}/' + status, pageSize, id:ndx.user.dezrez.Id, (err, body) ->
          if not err
            for role in body.Collection
              if roleIds.indexOf(role.Id) is -1
                roleIds.push role.Id
          callback()
      , ->
        async.each roleIds, (roleId, callback) ->
          ndx.dezrez.get 'role/{id}/' + type, pageSize, id:roleId, (err, body) ->
            if not err
              for item in body.Collection
                items.push item
            callback()
        , ->
          res.json items
      

        
    