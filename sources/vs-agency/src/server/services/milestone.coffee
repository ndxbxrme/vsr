'use strict'
superagent = require 'superagent'

module.exports = (ndx) ->
  fetchContacts = (action, property) ->
    contacts = []
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
          ndx.database.select 'users', null, (res) ->
            if res and res.length
              for user in res
                if user.roles and user.roles.agency
                  contacts.push
                    name: user.displayName or user.local.email
                    role: 'Agency'
                    email: user.email or user.local.email
                    telephone: user.telephone
        if contact is 'alladmin'
          ndx.database.select 'users', null, (res) ->
            if res and res.length
              for user in res
                console.log 'checking', user
                if user.roles and user.roles.admin
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
    contacts
  processActions = (actionOn, actions, roleId, property) ->
    if actions and actions.length
      if not property
        #grab property and case details
        superagent.get "#{process.env.PROPERTY_URL}/property/#{roleId}"
        .set 'Authorization', 'Bearer ' + process.env.PROPERTY_TOKEN
        .send()
        .end (err, res) ->
          if not err
            property = res.body
            ndx.property.fetch roleId, (mycase) ->
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
  getDefaultProgressions = (property) ->
    property.progressions = []
    ndx.database.select 'progressions',
      isdefault: true
    , (progressions) ->
      for progression in progressions
        ###
        for milestone in progression.milestones[0]
          milestone.progressing = false
          milestone.completed = true
          milestone.startTime = new Date().valueOf()
          milestone.completedTime = new Date().valueOf()
        ###
        property.progressions.push JSON.parse JSON.stringify progression
  calculateMilestones = (property) ->
    if property.progressions and property.progressions.length
      updateEstDays = (progressions) ->
        aday = 24 * 60 * 60 * 1000
        fetchMilestoneById = (id, progressions) ->
          for myprogression in progressions
            for mybranch in myprogression.milestones
              for mymilestone in mybranch
                if mymilestone._id is id
                  return mymilestone
        for progression in progressions
          for branch in progression.milestones
            for milestone in branch
              milestone.estCompletedTime = null
        needsCompleting = true
        i = 0
        while needsCompleting and i++ < 5
          for progression in progressions
            delete progression.needsCompleting
            progStart = progression.milestones[0][0].completedTime
            b = 1
            while b++ < progression.milestones.length
              branch = progression.milestones[b-1]
              for milestone in branch
                milestone.overdue = false
                milestone.afterTitle = ''
                if milestone.estCompletedTime
                  continue
                if milestone.completed and milestone.completedTime
                  milestone.estCompletedTime = milestone.completedTime
                  continue
                if milestone.userCompletedTime
                  try
                    milestone.estCompletedTime = new Date(milestone.userCompletedTime).valueOf()
                    continue
                if not milestone.estAfter
                  prev = progression.milestones[b-2][0]
                  milestone.estCompletedTime = (prev.completedTime or prev.estCompletedTime) + (milestone.estDays * aday)
                  continue
                testMilestone = fetchMilestoneById milestone.estAfter, progressions
                if testMilestone
                  if milestone.estType is 'complete'
                    if testMilestone.completedTime or testMilestone.estCompletedTime
                      milestone.estCompletedTime = (testMilestone.completedTime or testMilestone.estCompletedTime) + (milestone.estDays * aday)
                    milestone.afterTitle = " after #{testMilestone.title} completed"
                  else
                    if testMilestone.completedTime or testMilestone.estCompletedTime
                      milestone.estCompletedTime = (testMilestone.completedTime or testMilestone.estCompletedTime) - (testMilestone.estDays * aday) + (milestone.estDays * aday)
                    milestone.afterTitle = " after #{testMilestone.title} started"
                else
                  progression.needsCompleting = true
                  b = progression.milestones.length
                  break
          needsCompleting = false
          for progression in progressions
            if progression.needsCompleting
              needsCompleting = true
        for progression in progressions
          delete progression.needsCompleting 
      updateEstDays property.progressions
      property.milestoneIndex = {}
      gotOverdue = false
      for progression, p in property.progressions
        for branch, b in progression.milestones
          for milestone in branch
            if milestone.userCompletedTime
              milestone.userCompletedTime = new Date(milestone.userCompletedTime).valueOf()
            if new Date().valueOf() > (milestone.userCompletedTime or milestone.estCompletedTime)
              milestone.overdue = true
              if p is 0 and milestone.progressing and not gotOverdue
                property.milestone = milestone
                gotOverdue = true
            if p is 0 and not gotOverdue
              if milestone.completed or milestone.progressing
                property.milestone = milestone
            if milestone.completed #unsure
              property.milestoneIndex[progression._id] = b
      if property.milestone
        property.milestoneStatus = 'progressing'
        if property.milestone.overdue
          property.milestoneStatus = 'overdue'
        if property.milestone.completed
          property.milestoneStatus = 'completed'
        property.cssMilestone = 
          completed: property.milestone.completed
          progressing: property.milestone.progressing
          overdue: property.milestoneStatus is 'overdue'
  ndx.milestone =
    processActions: processActions
    getDefaultProgressions: getDefaultProgressions
    calculateMilestones: calculateMilestones
    