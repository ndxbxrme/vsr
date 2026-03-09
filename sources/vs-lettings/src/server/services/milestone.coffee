'use strict'
superagent = require 'superagent'
putError = require '../puterror.js'

module.exports = (ndx) ->
  fetchContacts = (action, property) ->
    contacts = []
    try
      if action.specificUser
        ndx.database.select 'users',
          _id: action.specificUser
        , (res) ->
          if res and res.length
            contacts.push
              email: res[0].email or res[0].local.email
      else
        for contact in action.to
          console.log 'contact', contact
          if contact.indexOf('all') is 0
            if contact is 'negotiator'
              negotiator = property.case.offer.Negotiators[0]
              contacts.push 
                name: negotiator.ContactName
                role: negotiator.JobTitle
                email: negotiator.PrimaryEmail.Value
                telephone: negotiator.PrimaryTelephone.Value
            if contact is 'allagency'
              ndx.database.select 'users', {sendEmail:true}, (res) ->
                if res and res.length
                  for user in res
                    if not user.deleted
                      if user.local and user.local.sites and user.local.sites.main and user.local.sites.main.role
                        if user.local.sites.main.role is 'agency'
                          contacts.push
                            name: user.displayName or user.local.email
                            role: 'Agency'
                            email: user.email or user.local.email
                            telephone: user.telephone
            if contact is 'alladmin'
              ndx.database.select 'users', {sendEmail:true}, (res) ->
                if res and res.length
                  for user in res
                    console.log 'checking', user
                    if not user.deleted
                      if user.local and user.local.sites and user.local.sites.main
                        if user.local.sites.main.role and ['superadmin', 'admin'].includes(user.local.sites.main.role)
                          if user.local.email
                            if user.local.email isnt 'superadmin@admin.com'
                              contacts.push
                                name: user.displayName or user.local.email
                                role: 'Admin'
                                email: user.email or user.local.email
                                telephone: user.telephone
          else
            if property.case[contact]
              contacts.push property.case[contact]
            else
              console.log 'could not find contact', contact
          console.log 'contacts', contacts
    catch e
      putError 'vslettings', e
    console.log contacts
    contacts
  processActions = (actionOn, actions, roleId, property) ->
    try
      if actions and actions.length
        if not property
          #grab property and case details
          superagent.get "#{process.env.PROPERTY_URL}/property/#{roleId}"
          .set 'Authorization', 'Bearer ' + process.env.PROPERTY_TOKEN
          .send()
          .end (err, res) ->
            if not err
              property = res.body
              property.AvailableDate = if property.AvailableDate.endsWith('Z') then property.AvailableDate else property.AvailableDate + 'Z'
              uId = property.RoleId + '_' + new Date(property.AvailableDate).valueOf()
              mycase = await ndx.property.fetch uId
              property.case = mycase
              processActions actionOn, actions, roleId, property
            else
              throw err
        else
          for action in actions
            if action.on is actionOn
              switch action.type
                when 'Trigger'
                  for progression in property.case.progressions
                    for branch in progression.milestones
                      for milestone in branch
                        if milestone._id is action.milestone
                          if action.triggerAction is 'complete'
                            if not milestone.completed
                              isStarted = milestone.startTime
                              milestone.completed = true
                              milestone.progressing = false
                              milestone.completedTime = new Date().valueOf()
                              if not isStarted
                                milestone.startTime = new Date().valueOf()
                              ndx.database.update 'properties', property.case,
                                _id: property.case._id
                              if not isStarted
                                processActions 'Start', milestone.actions, roleId, property
                              processActions 'Complete', milestone.actions, roleId, property
                          else
                            if not milestone.startTime
                              milestone.progressing = true
                              milestone.startTime = new Date().valueOf()
                              ndx.database.update 'properties', property.case,
                                _id: property.case._id
                              processActions 'Start', milestone.actions, roleId, property
                when 'Email'
                  contacts = fetchContacts action, property
                  ndx.database.select 'emailtemplates',
                    _id: action.template
                  , (res) ->
                    if res and res.length
                      for contact in contacts
                        if contact and contact.email and res[0].subject and res[0].body and res[0].from
                          if process.env.EMAIL_OVERRIDE
                            res[0].subject = "#{res[0].subject} <#{contact.email}>"
                          console.log 'about to send'
                          ndx.email.send
                            to: contact.email
                            subject: res[0].subject
                            body: res[0].body
                            from: res[0].from
                            contact: contact
                            property: property
                        else
                          console.log 'bad email template'
                          console.log res[0]
                          console.log  contact
                when 'Sms'
                  contacts = fetchContacts action, property
                  ndx.database.select 'smstemplates',
                    _id: action.template
                  , (res) ->
                    if res and res.length
                      for contact in contacts
                        ndx.sms.send
                          originator: 'VitalSpace'
                          numbers: [contact.telephone]
                          body: res[0].body
                        ,
                          contact: contact
                          property: property
    catch e
      putError 'vslettings', e
  ndx.milestone =
    processActions: processActions
    