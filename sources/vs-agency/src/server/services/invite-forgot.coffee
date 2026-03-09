'use strict'

module.exports = (ndx) ->
  if ndx.invite
    ndx.invite.fetchTemplate = (data, cb) ->
      ndx.database.select 'emailtemplates',
        name: 'User Invite'
      , (templates) ->
        if templates and templates.length
          cb
            subject: templates[0].subject
            body: templates[0].body
            from: templates[0].from
        else
          cb
            subject: "You have been invited"
            body: 'h1 invite\np\n  a(href="#{code}")= code'
            from: "System"
          
  if ndx.forgot
    ndx.forgot.fetchTemplate = (data, cb) ->
      ndx.database.select 'emailtemplates',
        name: 'Forgot Password'
      , (templates) ->
        if templates and templates.length
          cb
            subject: templates[0].subject
            body: templates[0].body
            from: templates[0].from
        else
          cb
            subject: "forgot password"
            body: 'h1 forgot password\np\n  a(href="#{code}")= code'
            from: "System"
