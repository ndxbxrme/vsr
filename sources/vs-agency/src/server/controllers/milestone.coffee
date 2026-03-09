'use strict'

module.exports = (ndx) ->
  ndx.app.post '/api/milestone/start', ndx.authenticate(), (req, res, next) ->
    actions = [{
      on: 'Start'
      type: 'Trigger'
      triggerAction: ''
      milestone: req.body.milestone
    }]
    ndx.milestone.processActions 'Start', actions, req.body.roleId
    res.end 'OK'
  ndx.app.post '/api/milestone/completed', ndx.authenticate(), (req, res, next) ->
    actions = [{
      on: 'Complete'
      type: 'Trigger'
      triggerAction: 'complete'
      milestone: req.body.milestone
    }]
    ndx.milestone.processActions 'Complete', actions, req.body.roleId
    res.end 'OK'