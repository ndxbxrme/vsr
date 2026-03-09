'use strict'

module.exports = (ndx) ->
  decorate = (args, cb) ->
    if args.obj.deleted
      return cb()
    switch args.table
      when 'leads'
        if args.obj.user
          args.obj.applicant = "#{args.obj.user.title or ''} #{args.obj.user.first_name or ''} #{args.obj.user.last_name or ''}".trim()
          args.obj.s = "#{args.obj.applicant.toLowerCase()}|#{(args.obj.property?.address || args.obj.user.address || '').toLowerCase()}|#{(args.obj.property?.postcode || args.obj.user.postcode || '').toLowerCase()}"
        cb true
      else
        cb true
  sendEmail = (args, cb) ->
    if args.table is 'leads'
      try
        lead = args.obj
        if lead and lead.email
          template = await ndx.database.selectOne 'emailtemplates', name: 'Auto Response - ' + lead.roleType
          if template
            template.to = lead.email
            template.lead = lead
            ndx.email.send template
      catch e
        console.log e
    cb true
  setImmediate ->
    ndx.database.on 'preInsert', decorate
    ndx.database.on 'preUpdate', decorate
    ndx.database.on 'insert', sendEmail