'use strict'
superagent = require 'superagent'
progress = require 'progress'
marked = require 'marked'

module.exports = (ndx) ->
  ndx.app.get '/api/properties/reset-progressions', ndx.authenticate(['admin','superadmin']), (req, res, next) ->
    ndx.database.select 'properties', null, (properties) ->
      if properties and properties.length
        for property in properties
          ndx.database.update 'properties',
            progressions: []
            milestone: ''
            milestoneIndex: ''
            milestoneStatus: ''
            cssMilestone: ''            
          ,
            _id: property._id
        ndx.property.checkNew()
      res.end 'OK'
  ndx.app.post '/api/properties/advance-progression', ndx.authenticate(), (req, res, next) ->
    milestones = []
    if req.body.milestone
      milestones.push req.body.milestone
    else
      for progression in req.body.property.progressions
        for branch in progression.milestones
          for milestone in branch
            if milestone.progressing and milestone.overdue
              milestones.push milestone
    advanceTo = req.body.advanceTo
    if advanceTo
      advanceTo = new Date advanceTo
    else
      noDays = +req.body.noDays
      advanceTo = new Date()
      advanceTo.setDate advanceTo.getDate() + noDays
    text = "## Advance Progression Request  \n#### Milestone#{if milestones.length>1 then 's' else ''}  \n"
    for milestone in milestones
      text += "`#{milestone.title}`  \n"
    text += "#### Advance to  \n`#{advanceTo.toDateString()}`  \n"
    text += "#### Requested by  \n`#{ndx.user.displayName or ndx.user.local.email}`  \n"
    text += "#### Reason  \n#{req.body.reason}  \n"
    advanceRequest =
      milestones: milestones 
      user: ndx.user
      roleId: req.body.property.roleId
      link: "#{req.protocol}://#{req.hostname}/case/#{req.body.property.roleId}"
      displayAddress: req.body.property.displayAddress
      advanceTo: advanceTo.valueOf()
      text: text
      reason: req.body.reason
      date: new Date()
    if ndx.email
      ndx.database.select 'emailtemplates',
        name: 'Advance Progression'
      , (templates) ->
        if templates and templates.length
          ndx.database.select 'users',
            roles:
              admin:
                $nnull: true
          , (users) ->
            if users and users.length
              for user in users
                Object.assign templates[0], advanceRequest
                templates[0].to = users[0].local.email
                templates[0].text = marked templates[0].text
                ndx.email.send templates[0]
    if not req.body.property.advanceRequests
      req.body.property.advanceRequests = []
    req.body.property.advanceRequests.push advanceRequest
    #save property
    ndx.database.update 'properties',
      advanceRequests: req.body.property.advanceRequests
    ,
      roleId: req.body.property.roleId.toString()
    res.end 'OK'
  ndx.app.post '/api/properties/send-new-sales-email', ndx.authenticate(), (req, res, next) ->
    if ndx.email
      user = ndx.user
      ndx.database.select 'users', null, (users) ->
        for user in users
          ndx.database.select 'emailtemplates',
            name: 'New Sales Instruction Email'
          , (templates) ->
            if templates and templates.length
              templates[0].newSales = req.body.newSales
              templates[0].user = user
              templates[0].to = user.local?.email
              ndx.email.send templates[0]
    res.end 'OK'
  ndx.app.post '/api/properties/send-reduction-email', ndx.authenticate(), (req, res, next) ->
    if ndx.email
      user = ndx.user
      ndx.database.select 'users', null, (users) ->
        for user in users
          ndx.database.select 'emailtemplates',
            name: 'Price Reduction Email' 
          , (templates) ->
            if templates and templates.length
              templates[0].reduction = req.body.reduction
              templates[0].user = user
              templates[0].to = user.local?.email
              ndx.email.send templates[0]
    res.end 'OK'
  ndx.app.get '/api/properties/:roleId', ndx.authenticate(), (req, res, next) ->
    ndx.property.fetch req.params.roleId, (property) ->
      res.json property
  ndx.app.get '/api/properties/:roleId/progressions', ndx.authenticate(), (req, res, next) ->
    ndx.database.select 'properties',
      roleId: req.params.roleId
    , (properties) ->
      if properties and properties.length
        res.json properties[0].progressions
      else
        res.json []
  ndx.app.post '/webhook', (req, res, next) ->
    res.end 'hi'
  #startup
  ndx.database.on 'ready', ->
    if not ndx.database.count 'properties'
      console.log 'building database'
      superagent.post "#{process.env.PROPERTY_URL}/search"
      .set 'Content-Type', 'application/json'
      .set 'Authorization', 'Bearer ' + process.env.PROPERTY_TOKEN
      .send
        RoleStatus: 'OfferAccepted'
        RoleType: 'Selling'
        IncludeStc: true
      .end (err, response) ->
        console.log 'building property database'
        if not err and response and response.body
          bar = new progress '  downloading [:bar] :percent :etas',
            complete: '='
            incomplete: ' '
            width: 20
            total: response.body.Collection.length
          fetchProp = (index) ->
            bar.tick 1
            if index < response.body.Collection.length
              ndx.property.fetch response.body.Collection[index].RoleId, ->
                fetchProp ++index
            else
              console.log '\ndatabase build complete'
          fetchProp 0
      