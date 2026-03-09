'use strict'
superagent = require 'superagent'
objtrans = require 'objtrans'
putError = require '../puterror.js'
fs = require 'fs'

module.exports = (ndx) ->
  debugInfo = {}
  getDefaultProgressions = (property) ->
    property.progressions = []
    ndx.database.select 'progressions',
      isdefault: true
    , (progressions) ->
      for progression in progressions
        if progression.deleted
          continue
        property.progressions.push JSON.parse JSON.stringify progression
  calculateMilestones = (property) ->
    try
      if not property
        return
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
    catch e
      putError 'vslettings', e
  fetchCurrentProps = (status) ->
    debugInfo.url = "#{process.env.PROPERTY_URL}/search"
    new Promise (resolve, reject) ->
      try
        opts = 
          RoleType: 'Letting'
          IncludeStc: true
        superagent.post "#{process.env.PROPERTY_URL}/search"
        .set 'Authorization', 'Bearer ' + process.env.PROPERTY_TOKEN
        .send opts
        .end (err, res) ->
          if not err and res.body.Collection
            debugInfo.count = res.body.Collection.length
            resolve res.body.Collection
          else
            reject err      
      catch e
        putError 'vslettings', e
        debugInfo.error = e
  fetchPropertyData = (prop) ->
    new Promise (resolve, reject) ->
      try
        prop.lettingData = await ndx.dezrez.get 'role/{id}', null, id:prop.RoleId
        if prop.lettingData and prop.lettingData.TenantRoleId
          prop.tenantData = await ndx.dezrez.get 'role/{id}', null, id:prop.lettingData.TenantRoleId
        else
          prop.tenantData =
            TenantInfo: [{}]
        prop.viewings = await ndx.dezrez.get 'role/{id}/viewingsbasic', null, id:prop.RoleId
        prop.extendedData = await ndx.dezrez.get 'property/{id}', null, id:prop.PropertyId
        property = objtrans prop,
          uId: true
          Address: true
          AvailableDate: true
          DateInstructed: true
          LastUpdated: true
          Fees: true
          Images: true
          Price: true
          PropertyId: true
          RoleId: true
          SearchField: true
          Term: true
          Status: 'RoleStatus.SystemName'
          displayAddress: true
          Id: '_id'
          Deposit: 'lettingData.Deposit'
          Landlord: 'lettingData.LandlordInfo[0].Person'
          LandlordName: 'lettingData.LandlordInfo[0].Person.ContactName'
          OfferAcceptedPriceDataContract: 'lettingData.OfferAcceptedPriceDataContract'
          ServiceLevel: 'lettingData.ServiceLevel'
          TenancyReference: 'tenantData.TenancyReference'
          TenancyStatus: 'tenantData.TenancyStatus'
          TenancyType: 'tenantData.TenancyType'
          TenantBaseDeposit: 'tenantData.TenantBaseDeposit'
          Tenants: 'tenantData.TenantInfo'
          Tenant: 'tenantData.TenantInfo[0].Person'
          TenantName: 'tenantData.TenantInfo[0].Person.ContactName'
          EstimatedStartDate: 'tenantData.EstimatedStartDate'
          Viewings: 'viewings'
          SpecialArrangements: 'extendedData.SpecialArrangements'
          purchasersContact: (input) ->
            if input.tenantData?.TenantInfo
              role: ''
              name: input.tenantData.TenantInfo[0]?.Person?.ContactName
              email: input.tenantData.TenantInfo[0]?.Person?.PrimaryEmail?.Value
              telephone: input.tenantData.TenantInfo[0]?.Person?.PrimaryTelephone?.Value
            else
              #console.log 'BAD PROP T', input.displayAddress
              {}
          vendorsContact: (input) ->
            if input.lettingData?.LandlordInfo
              role: ''
              name: input.lettingData.LandlordInfo[0]?.Person?.ContactName
              email: input.lettingData.LandlordInfo[0]?.Person?.PrimaryEmail?.Value
              telephone: input.lettingData.LandlordInfo[0]?.Person?.PrimaryTelephone?.Value
            else
              #console.log 'BAD PROP L', input.displayAddress
              {}
        resolve property
      catch e
        putError 'vslettings', e
  checkNew = ->
    debugInfo =
      time: new Date()
    try
      currentProps = await fetchCurrentProps()
      console.log '\n\nDEZREZ - ' + (new Date().toString()) + '\n'
      for prop in currentProps
        console.log Object.values(prop.Address).filter((prop) -> typeof(prop) is 'string' and prop isnt "").join(', ').slice(0,30), (prop.RoleStatus or {}).SystemName
        prop.AvailableDate = if prop.AvailableDate.endsWith('Z') then prop.AvailableDate else prop.AvailableDate + 'Z'
        prop.uId = prop.RoleId + '_' + new Date(prop.AvailableDate).valueOf()
        dbProperty = await ndx.property.fetch prop.uId
        if dbProperty
          #if prop.LastUpdated isnt dbProperty.LastUpdated
          if ['OfferAccepted', 'InstructionToLet'].includes prop.RoleStatus.SystemName
            property = await fetchPropertyData prop
            Object.assign dbProperty, property
          else
            dbProperty.Status = prop.RoleStatus.SystemName
          calculateMilestones dbProperty
          ndx.database.update 'properties', dbProperty,
            _id: dbProperty._id
        else
          property = await fetchPropertyData prop
          getDefaultProgressions property
          calculateMilestones property
          property.delisted = false
          property.milestone = ''
          property.milestoneStatus = ''
          property.milestoneIndex = null
          property.notes = []
          property.chainBuyer = []
          property.chainSeller = []
          ndx.database.insert 'properties', property
      allProps = await ndx.database.select 'properties',
        where:
          $or: [
            Status: 'OfferAccepted'
          ,
            Status: 'InstructionToLet'
          ]
          delisted: false
      for prop in allProps
        foundit = false
        for cProp in currentProps
          if cProp.RoleId is prop.RoleId
            foundit = true
            break
        if not foundit
          property = await fetchPropertyData prop
          Object.assign prop, property
          calculateMilestones prop
          prop.delisted = true
          console.log 'delisting', prop._id
          ndx.database.update 'properties', prop,
            _id: prop._id
    catch e
      putError 'vslettings', e
  ndx.database.on 'ready', ->
    #setInterval checkNew, 10 * 60 * 1000
    #checkNew()
  webhookCalls = 0
  ndx.app.post '/webhook', (req, res, next) ->
    console.log 'WEBHOOK CALLED'
    webhookCalls++
    checkNew()
    res.end 'ok'
  ndx.app.get '/status', (req, res, next) ->
    res.json
      webhookCalls: webhookCalls
      debugInfo: debugInfo
  ndx.property = 
    getDefaultProgressions: 'getDefaultProgressions'
    checkNew: checkNew
    fetch: (uId, cb) ->
      new Promise (resolve, reject) ->
        property = await ndx.database.selectOne 'properties', uId: uId
        resolve property
        cb? property