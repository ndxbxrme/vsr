module.exports = (ndx) ->
  ndx.database.on 'ready', ->
    nextSendTime = null
    sendUnknownSolicitorEmails = ->
      ndx.database.select 'properties', 
        where:
          delisted: false
      , (properties) ->
        solicitors = []
        myproperties = []
        reduce = (name) ->
          (name or 'Unknown').toLowerCase().replace(/solicitor(s*)/g, '').replace(/law|llp/g,'').replace(/ll/g, 'l').replace(/ [a-z] /, '').replace(' & ', '').replace(' and ', '').replace(/\s+/g, '')
        getSolicitor = (name, sol) ->
          for solicitor in solicitors
            if reduce(solicitor.name) is reduce(name)
              return solicitor
          solicitor =
            id: solicitors.length
            name: name or 'Unknown'
          solicitors.push solicitor
          solicitor
        for property in properties
          ps = getSolicitor property.purchasersSolicitor?.role
          vs = getSolicitor property.vendorsSolicitor?.role
          if ps.name is 'Unknown' or vs.name is 'Unknown'
            if not myproperties.filter((item) -> item.id is property.roleId).length
              myproperties.push
                address: "#{property.offer?.Property?.Address.Number} #{property.offer?.Property?.Address.Street }, #{property.offer?.Property?.Address.Locality }, #{property.offer?.Property?.Address.Town}, #{property.offer?.Property?.Address.Postcode}"
                id: property.roleId
                purchasingSolicitor: ps.name is 'Unknown'
                vendingSolicitor: vs.name is 'Unknown'
        if myproperties.length
          if ndx.email
            ndx.database.select 'emailtemplates',
              name: 'Unknown Solicitors'
            , (templates) ->
              if templates and templates.length
                ndx.database.select 'users',
                  deleted: null
                , (users) ->
                  if users and users.length
                    for user in users
                      console.log 'sending to', user.local?.email
                      templates[0].unknowns = myproperties
                      templates[0].user = user
                      templates[0].to = user.local?.email
                      ndx.email.send templates[0]
            , true
      , true
    resetNextSendTime = ->
      nextSendTime = new Date(new Date(new Date().toDateString()).setHours(10))
      nextSendTime = new Date(nextSendTime.setDate(nextSendTime.getDate() + 1))
    resetNextSendTime()
    nextSendTime = new Date()
    setInterval ->
      if new Date() > nextSendTime
        if 0 < nextSendTime.getDay() < 6
          sendUnknownSolicitorEmails()
        resetNextSendTime()
    , 10000