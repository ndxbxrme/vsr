'use strict'
async = require 'async'

module.exports = (ndx) ->
  doSendEmail = (template, email, lead, user) ->
    if email and template and lead and user
      template.lead = lead
      template.user = user
      template.host = ndx.host
      template.to = email
      ndx.email.send template
  sendEmails = (action, lead, user) ->
    ndx.database.select 'emailtemplates',
      where:
        action: action
    , (templates) ->
      if templates and templates.length
        async.each templates, (template, templateCb) ->
          if template.sendTo and template.sendTo.length
            async.each template.sendTo, (sendTo, sendCb) ->
              console.log 'sendto', sendTo
              switch sendTo
                when 'applicant'
                  doSendEmail template, lead.email, lead, user
                  sendCb()
                else
                  where = 
                    roles: {}
                  where.roles[sendTo] =
                    $nn: true
                  ndx.database.select 'users',
                    where: where
                  , (users) ->
                    if users and users.length
                      async.each users, (user, userCb) ->
                        doSendEmail template, user.local.email, lead, user
                        userCb()
                      , ->
                        sendCb()
                    else
                      sendCb()
            , ->
              #send done
              templateCb()
          else
            templateCb()
        , ->
          #templates done
  ndx.database.on 'update', (args, cb) ->
    switch args.table
      when 'leads'
        action = ''
        if args.obj.roleType is 'Valuation'
          action += 'valuation'
        else
          action += 'lead'
        if args.changes.booked
          action += 'Booked'
        if args.changes.deleted and not args.changes.deleted.from
          action += 'Deleted'
    sendEmails action, args.obj, args.user
    cb true
  ndx.database.on 'insert', (args, cb) ->
    switch args.table
      when 'leads'
        action = ''
        if args.obj.roleType is 'Valuation'
          action += 'valuation'
        else
          action += 'lead'
        action += 'Added'
    sendEmails action, args.obj, args.user
    cb true