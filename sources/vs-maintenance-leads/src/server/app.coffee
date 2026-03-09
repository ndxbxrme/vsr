'use strict' 
marked = require 'marked'
superagent = require 'superagent'
bodyParser = require 'body-parser'
multiparty = require 'multiparty'
jade = require 'jade'
fs = require 'fs-extra'
apiKey = process.env.EMAIL_API_KEY
mgDomain = 'mg.vitalspace.co.uk'
mailgun = require('mailgun-js')
  apiKey: apiKey
  domain: mgDomain
require 'ndx-server'
.config
  database: 'db'
  tables: ['users', 'issues', 'tasks', 'contractors', 'landlords', 'messages', 'emailtemplates', 'smstemplates', 'shorttoken']
  localStorage: './data'
  hasInvite: true
  hasForgot: true
  softDelete: true
.use (ndx) ->
  assignAddressAndNames = (args, cb) ->
    if args.changes?.deleted
      return cb true
    if args.table is 'issues'
      if args.obj.booked 
        contractor = await ndx.database.selectOne 'contractors', _id:args.obj.booked
        args.obj.contractor = contractor.name
      args.oldObj = args.oldObj or {}
      args.obj.address = "#{args.obj.address1 or args.oldObj.address1}#{if (args.obj.address2 or args.oldObj.address2) then ', ' + (args.obj.address2 or args.oldObj.address2) else ''}, #{args.obj.postcode or args.oldObj.postcode}"
      args.obj.tenant = "#{if args.obj.tenantTitle or args.oldObj?.tenantTitle then (args.obj.tenantTitle or args.oldObj.tenantTitle) + ' ' else ''}#{args.obj.tenantFirstName or args.oldObj.tenantFirstName} #{args.obj.tenantLastName or args.oldObj.tenantLastName}"
      args.obj.search = (args.obj.address or '') + '|' + (args.obj.tenant or '') + '|' + (args.obj.contractor or '') + '|' + (args.obj.title or args.oldObj?.title or '') + '|' + (args.obj.cfpJobNumber or args.oldObj?.cfpJobNumber or '')
      ###
      args.obj.status = args.obj.status or
        booked: false
        completed: false
        invoiced: false
      if typeof(args.obj.status) is 'string'
        args.obj.status = switch args.obj.status
          when 'Reported' then {booked:false,completed:false,invoiced:false}
          when 'Booked' then {booked:true,completed:false,invoiced:false}
          when 'Completed' then {booked:true,completed:true,invoiced:false}
          else {booked:false,completed:false,invoiced:false}
      args.obj.statusName = 'Reported'
      args.obj.statusName = 'Booked' if args.obj.status.booked
      args.obj.statusName = 'Completed' if args.obj.status.completed
      ###
    if args.table is 'tasks'
      contractor = await ndx.database.selectOne 'contractors', _id:args.obj.contractor or args.oldObj.contractor
      args.obj.contractorName = contractor.name
      issue = await ndx.database.selectOne 'issues', _id: args.obj.issue
      if issue
        issue.contractorName = contractor.name
        issue.notes = issue.notes or []
        issue.notes.push
          date: new Date().valueOf()
          text: 'Task assigned to - ' + contractor.name
          item: 'Note'
          side: ''
          user: args.user
        ndx.database.upsert 'issues', issue
    cb true
  updateStatus = (args, cb) ->
    if args.table is 'tasks'
      issue = await ndx.database.selectOne 'issues', _id: args.obj.issue
      if args.op is 'insert'
        issue.status = {booked:true,completed:false,invoiced:false}
        issue.statusName = 'Booked'
        issue.cfpJobNumber = args.obj.cfpJobNumber
        ndx.database.upsert 'issues', issue
      else
        if not args.changes.deleted
          issue.cfpJobNumber = args.obj.cfpJobNumber or args.oldObj?.cfpJobNumber
          ndx.database.upsert 'issues', issue
    else if args.table is 'issues'
      if args.op is 'insert'
        args.obj.statusName = 'Reported'
    cb true
  sendMessage = (issue, contractor, method, name, mailOrNo) ->
    template = await ndx.database.selectOne method + 'templates', name: name
    if issue and template
      if contractor and mailOrNo
        issue.contractor = contractor.name
        if method is 'email'
          template.to = mailOrNo.trim()
          template.subject = template.subject
          Object.assign template, issue
          ndx.email.send template
        else if method is 'sms'
          ndx.sms.send
            originator: 'VitalSpace'
            numbers: [mailOrNo.trim()]
            body: template.body
          , template
  sendMessages = (args, cb) ->        
    if args.table is 'issues'
      if args.changes?.statusName?.to
        if args.changes.statusName.to isnt 'Reported'
          issue = Object.assign args.oldObj, args.obj
          task = await ndx.database.selectOne 'tasks', issue:issue._id
          if task
            contractor = await ndx.database.selectOne 'contractors', _id:task.contractor
            if issue and contractor
              switch args.changes.statusName?.to
                when 'Booked'
                  #sendMessage issue, contractor, 'email', 'TenantBooked', issue.tenantEmail
                  #sendMessage issue, contractor, 'sms', 'TenantBooked', issue.tenantPhone
                  sendMessage issue, contractor, 'email', 'Booked', contractor.email
                  sendMessage issue, contractor, 'sms', 'Booked', contractor.phone
                when 'Completed'
                  sendMessage issue, contractor, 'email', 'Completed', issue.tenantEmail
                  sendMessage issue, contractor, 'sms', 'Completed', issue.tenantPhone
                  #sendMessage issue, contractor, 'email', 'ContractorCompleted', contractor.email
                  #sendMessage issue, contractor, 'sms', 'ContractorCompleted', contractor.phone
              args.obj.notes = args.obj.notes or args.oldObj.notes or []
              if args.user
                args.obj.notes.push
                  date: new Date().valueOf()
                  text: args.changes.statusName?.to + ' - ' + contractor.name
                  item: 'Note'
                  side: ''
                  user: args.user
    cb true
  sendSockets = (args, cb) ->
    if args.table is 'issues'
      ndx.socket.emitToAll 'newIssue', args.obj
    cb true
  checkDeleted = (args, cb) ->
    if args.changes.deleted?.to
      if args.table is 'issues'
        args.obj.status = {}
        args.obj.statusName = 'Reported'
        ndx.database.update 'tasks',
          deleted: true
        ,
          issue: args.id
        , null, true
      if args.table is 'tasks'
        ndx.database.update 'issues',
          status: {}
          statusName: 'Reported'
        , args.oldObj.issue, null, true
    cb true
  addressesMatch = (add1, add2) ->
    add1 = add1.toUpperCase().replace(/[, ]+/g, '')
    add2 = add2.toUpperCase().replace(/[, ]+/g, '')
    return false if not add1 or not add2
    i = Math.min 30, Math.min add1.length, add2.length
    good = true
    while i-- > 0
      good = good and (add1[i] is add2[i])
    good
  assignProperties = (args, cb) ->  
    if args.table is 'landlords'
      #removed addresses, do we care?
      console.log args.changes
      if args.obj.addresses
        for address in args.obj.addresses
          [postcode] = address.split(/, */g).reverse()
          if postcode
            issues = await ndx.database.select 'issues',
              postcode: postcode
            for issue in issues
              if addressesMatch issue.address, address
                await ndx.database.update 'issues',
                  landlordId: args.obj._id
                ,
                  _id: issue._id
                , null, true
    if args.table is 'issues'
      #if landlord has changed, update landlord addresses
      oldLandlord = args.changes?.landlordId?.from
      newLandlord = args.changes?.landlordId?.to or args.obj.landlordId
      if oldLandlord
        #remove address from landlord
        landlord = await ndx.database.selectOne 'landlords', _id: oldLandlord
        landlord.addresses = landlord.addresses.filter (address) ->
          [postcode] = address.split(/, */g).reverse()
          return true if postcode isnt args.obj.postcode
          return false if addressesMatch address, args.obj.address
          return true
        await ndx.database.update 'landlords', landlord, _id:landlord._id, null, true
      if newLandlord
        landlord = await ndx.database.selectOne 'landlords', _id: newLandlord
        if landlord
          landlord.addresses = landlord.addresses or []
          myaddress = landlord.addresses.find (address) ->
            [postcode] = address.split(/, */g).reverse()
            postcode is args.obj.postcode and addressesMatch address, args.obj.address
          if not myaddress
            landlord.addresses.push args.obj.address
            await ndx.database.update 'landlords', landlord, _id:landlord._id, null, true
          #add address to landlord if it isn't there already
      console.log args.changes
    cb? true
  assignLandlord = (args, cb) ->
    if args.table is 'issues'
      if not args.obj.landlordId
        landlords = await ndx.database.select 'landlords'
        for landlord in landlords
          if landlord.addresses
            for address in landlord.addresses
              [postcode] = address.split(/, */g).reverse()
              if postcode is args.obj.postcode and addressesMatch address, args.obj.address
                args.obj.landlordId = landlord._id
                return cb? true
    cb? true
  ndx.database.on 'preUpdate', assignAddressAndNames
  ndx.database.on 'preInsert', assignAddressAndNames
  ndx.database.on 'update', updateStatus
  ndx.database.on 'insert', updateStatus
  ndx.database.on 'preUpdate', sendMessages
  ndx.database.on 'preInsert', sendMessages
  ndx.database.on 'insert', sendSockets
  ndx.database.on 'preUpdate', checkDeleted
  ndx.database.on 'update', assignProperties
  ndx.database.on 'insert', assignProperties
  ndx.database.on 'preInsert', assignLandlord
.use (ndx) ->
  ndx.addPublicRoute '/api/mailin'
  ndx.addPublicRoute '/api/fixflo/pdf'
  ndx.app.get '/api/emit', (req, res, next) ->
    issue = await ndx.database.selectOne 'issues'
    ndx.socket.emitToAll 'newIssue', issue
    res.end 'OK'
  ndx.app.get '/api/update-statuses', ndx.authenticate(), (req, res, next) ->
    issues = await ndx.database.select 'issues'
    for issue in issues
      if not issue.statusName
        issue.statusName = 'Reported'
        issue.statusName = 'Booked' if issue.booked
        issue.statusName = 'Completed' if issue.completed
      if issue.booked and not issue.contractorName
        contractor = await ndx.database.selectOne 'contractors', _id:issue.booked
        if contractor
          issue.contractorName = contractor.name
      ndx.database.upsert 'issues', issue
    res.end 'OK'
  ndx.app.post '/api/notes/:issueId', ndx.authenticate(), (req, res, next) ->
    ndx.database.update 'issues',
      notes: req.body.notes
    ,
      _id: req.params.issueId
    res.end 'OK'
  ndx.app.get '/api/chase/:method/:taskId', ndx.authenticate(), (req, res, next) ->
    user = ndx.user
    template = await ndx.database.selectOne req.params.method + 'templates', name: 'Chase'
    task = await ndx.database.selectOne 'tasks', _id:req.params.taskId
    issue = await ndx.database.selectOne 'issues', _id:task.issue
    if template and issue and task
      contractor = await ndx.database.selectOne 'contractors', _id:task.contractor
      if contractor
        issue.contractor = contractor.name
        if req.params.method is 'email'
          template.to = contractor.email.trim()
          template.subject = template.subject
          Object.assign template, issue
          ndx.email.send template
        else if req.params.method is 'sms'
          ndx.sms.send
            originator: 'VitalSpace'
            numbers: [contractor.phone.trim()]
            body: template.body
          , template
        issue.notes = issue.notes or []
        issue.notes.push
          date: new Date().valueOf()
          text: 'Contractor - ' + contractor.name + ' chased by ' + req.params.method
          item: 'Note'
          side: ''
          user: user
        ndx.database.upsert 'issues', issue
    res.end 'OK'
  ndx.app.get '/api/chase-invoice/:method/:taskId', ndx.authenticate(), (req, res, next) ->
    user = ndx.user
    template = await ndx.database.selectOne req.params.method + 'templates', name: 'ChaseInvoice'
    task = await ndx.database.selectOne 'tasks', _id:req.params.taskId
    issue = await ndx.database.selectOne 'issues', _id:task.issue
    if template and issue and task
      contractor = await ndx.database.selectOne 'contractors', _id:task.contractor
      if contractor
        issue.contractor = contractor.name
        if req.params.method is 'email'
          template.to = contractor.email.trim()
          template.subject = template.subject
          Object.assign template, issue
          ndx.email.send template
        else if req.params.method is 'sms'
          ndx.sms.send
            originator: 'VitalSpace'
            numbers: [contractor.phone.trim()]
            body: template.body
          , template
        issue.notes = issue.notes or []
        issue.notes.push
          date: new Date().valueOf()
          text: 'Invoice for contractor - ' + contractor.name + ' chased by ' + req.params.method
          item: 'Note'
          side: ''
          user: user
        ndx.database.upsert 'issues', issue
    res.end 'OK'
  ndx.app.get '/api/inform/:method/:taskId', ndx.authenticate(), (req, res, next) ->
    template = await ndx.database.selectOne req.params.method + 'templates', name: 'Inform'
    task = await ndx.database.selectOne 'tasks', _id:req.params.taskId
    issue = await ndx.database.selectOne 'issues', _id:task.issue
    user = ndx.user
    if template and issue and task
      contractor = await ndx.database.selectOne 'contractors', _id:task.contractor
      if contractor
        issue.contractor = contractor.name
        if req.params.method is 'email'
          template.to = issue.tenantEmail.trim()
          template.subject = template.subject
          Object.assign template, issue
          ndx.email.send template
        else if req.params.method is 'sms'
          ndx.sms.send
            originator: 'VitalSpace'
            numbers: [issue.tenantPhone.trim()]
            body: template.body
          , template
        issue.notes = issue.notes or []
        issue.notes.push
          date: new Date().valueOf()
          text: 'Tenant informed by ' + req.params.method
          item: 'Note'
          side: ''
          user: user
        ndx.database.upsert 'issues', issue
    res.end 'OK'
  ndx.app.get '/api/complete/:issueId', ndx.authenticate(), (req, res, next) ->
    ndx.database.update 'issues',
      statusName: 'Completed'
    ,
      _id: req.params.issueId
    issue = await ndx.database.selectOne 'issues', _id: req.params.issueId
    if issue
      sendMessage = (method, mailOrNo) ->
        template = await ndx.database.selectOne method + 'templates', name: 'Complete'
        if issue and template
          contractor = await ndx.database.selectOne 'contractors', _id:issue.booked
          if contractor and mailOrNo
            issue.contractor = contractor.name
            if method is 'email'
              template.to = mailOrNo.trim()
              template.subject = template.subject
              Object.assign template, issue
              ndx.email.send template
            else if method is 'sms'
              ndx.sms.send
                originator: 'VitalSpace'
                numbers: [mailOrNo.trim()]
                body: template.body
              , template
      sendMessage 'email', issue.tenantEmail
      sendMessage 'sms', issue.tenantPhone
    res.end 'OK'
  ndx.app.get '/api/restore/:issueId', ndx.authenticate(), (req, res, next) ->
    issue = await ndx.database.selectOne 'issues', _id: req.params.issueId
    if issue
      issue.status = {}
      issue.statusName = 'Reported'
      issue.deleted = null
      issue.cfpJobNumber = null
      issue.notes = issue.notes or []
      issue.notes.push
        date: new Date().valueOf()
        text: 'Restored'
        item: 'Note'
        side: ''
        user: ndx.user
      await ndx.database.update 'tasks',
        deleted: true
      ,
        issue: issue._id
      ndx.database.upsert 'issues', issue
    res.end 'OK'
  ndx.app.get '/api/fixflo/pdf/:fixfloId', (req, res, next) ->
    {body} = await superagent.get ndx.fixflo.issuesUrl.replace(/s$/, '') + '/' + req.params.fixfloId + '/report'
    .set 'Authorization', 'Bearer ' + process.env.FIXFLO_KEY
    .buffer true
    res.setHeader 'Content-Type', 'application/pdf'
    res.send body
  ndx.app.all '/api/mailin', bodyParser.urlencoded({extended:true}), (req, res, next) ->
    parseForm = ->
      ndx.reporter.log 'parse form'
      new Promise (resolve, reject) ->
        form = new multiparty.Form();
        form.parse req, (err, fields, files) ->
          obj = 
            subject: fields.subject[0]
            sender: fields.sender[0]
            date: new Date(fields.Date[0])
            body: fields['body-plain'][0]
            text: fields['stripped-text'][0]
            attachments: []
            
          ndx.reporter.log obj.subject
          for key, file of files
            #save file to uploads
            ndx.reporter.log 'file upload ' + key
            fileInfo = await new Promise (res) ->
              ndx.fileUpload.saveFile file[0], {}, {}, (err, fileInfo) ->
                ndx.reporter.log 'file error' + err.toString()
                res fileInfo
            console.log 'file', fileInfo
            try
              fs.unlinkSync file[0].path
            #await fs.move file[0].path, newPath
            ndx.reporter.log 'file upload success'
            obj.attachments.push fileInfo
          resolve obj
    myobj = null
    if not req.body.subject
      myobj = await parseForm()
    else
      myobj =
        subject: req.body.subject
        sender: req.body.sender
        date: new Date(req.body.Date)
        body: req.body['body-plain']
        text: req.body['stripped-text']
        attachments: []
    myobj.dir = 'in'
    try
      [,issueId] = myobj.body.match(/:I(.*)?:/)
    catch e
      ndx.reporter.log 'email error'
      console.log 'EMAIL ERROR'
      console.log myobj
    if issueId
      [issueId, replyId] = issueId.split '+'
      if replyId.includes '/'
        [replyId, toEntity] = replyId.split '/'
      myobj.replyId = replyId
      issue = await ndx.database.selectOne 'issues', _id: issueId
      if issue
        if toEntity
          if toEntity is 'T'
            myobj.from = 'Tenant'
            myobj.fromName = issue.tenant
          else if toEntity is 'L'
            landlord = await ndx.database.selectOne 'landlords', _id: issue.landlordId
            if landlord
              myobj.from = 'Landlord'
              myobj.fromName = landlord.name
          else if toEntity is 'C'
            myobj.from = 'Contractor'
            myobj.fromName = issue.contractor
            
        else
          if myobj.sender is issue.tenantEmail
            myobj.from = 'Tenant'
            myobj.fromName = issue.tenant
          else
            landlord = await ndx.database.selectOne 'landlords', _id: issue.landlordId
            if landlord and landlord.email is myobj.sender
              myobj.from = 'Landlord'
              myobj.fromName = landlord.name
            else
              myobj.from = 'Contractor'
              myobj.fromName = issue.contractor
        issue.messages = issue.messages or []
        issue.messages.push myobj
        issue.documents = issue.documents or []
        for attachment in myobj.attachments
          issue.documents.push attachment
        issue.newMessages = (issue.newMessages or 0) + 1
        await ndx.database.update 'issues', issue, _id: issueId
        ndx.socket.emitToAll 'newMessage',
          address: issue.address
          subject: myobj.subject
          from: myobj.from
    reporter.log 'email handled successfully'
    console.log 'done it', myobj
    res.status(200)
    res.end('Ok')
  
  ndx.app.post '/api/message-center/send', ndx.authenticate(), (req, res, next) ->
      #move attachments to temp folder ready for attaching, subfolders for each file?
    try
      [toEntity,toName,toEmail] = req.body.item.messageTo.split '::'
      attachments = []
      replyId = req.body.replyId or new Date().getTime().toString(23)
      replyId += '/' + toEntity[0]
      if req.body.attachments and req.body.attachments.length
        for attachment in req.body.attachments
          response = await superagent.get attachment.url
          .responseType 'arraybuffer'
          attachments.push new mailgun.Attachment
            data: response.body
            filename: attachment.originalFilename
      outBody = req.body.body
      outBody = outBody.replace(/[\r\n]+________________________________[\r\n]+:I.+?\+.+:/g, '')
      outBody += '\r\n\r\n________________________________\r\n:I' + req.body.issueId + '+' + replyId + ':'
      template = await ndx.database.selectOne 'emailtemplates', name: 'MessageCenter'
      template.body = jade.render(template.body, body: outBody)
      data = 
        from: template.from or 'Vitalspace Test <testing@mg.vitalspace.co.uk>'
        to: process.env.EMAIL_OVERRIDE or toEmail
        subject: req.body.item?.subject or template.subject
        html: template.body
      if attachments.length
        data.attachment = attachments
      user = ndx.user
      mailgun.messages().send data, (error, body) ->
        issue = await ndx.database.selectOne 'issues', _id: req.body.issueId
        if issue
          if req.body.prevBody
            req.body.body = req.body.body.replace req.prevBody, ''
          issue.messages = issue.messages or []
          issue.messages.push
            dir: 'out'
            subject: data.subject
            to: data.to
            toEntity: toEntity
            toName: toName
            date: new Date()
            body: data.text
            text: req.body.body
            replyId: replyId
            user: user
            attachments: req.body.attachments
            error: error
          ndx.database.update 'issues', issue, _id: req.body.issueId
          
          #fs.rmdirSync attachment.replace(/\/[^\/]*$/, '')
        console.log error, body
        
      res.end 'OK'
    catch e
      res.json e
.start()
