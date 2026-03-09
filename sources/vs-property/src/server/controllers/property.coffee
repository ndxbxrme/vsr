'use strict'

superagent = require 'superagent'

module.exports = (ndx) ->
  apiUrl = process.env.API_URL or ndx.settings.API_URL
  apiKey = process.env.API_KEY or ndx.settings.API_KEY
  ndx.app.post '/api/search', (req, res) ->
    whereProps = []
    whereSql = ' true=true '
    if req.body.MinimumPrice
      whereSql += ' AND Price->PriceValue >= ? '
      whereProps.push +req.body.MinimumPrice
    if req.body.MaximumPrice and req.body.MaximumPrice isnt '0'
      whereSql += ' AND Price->PriceValue <= ? '
      whereProps.push +req.body.MaximumPrice
    if req.body.MinimumBedrooms
      whereSql += ' AND RoomCountsDescription->Bedrooms >= ? '
      whereProps.push +req.body.MinimumBedrooms
    if req.body.MaximumBedrooms and req.body.MaximumBedrooms isnt '0'
      whereSql += ' AND RoomCountsDescription->Bedrooms <= ? '
      whereProps.push +req.body.MaximumBedrooms
    if req.body.MinimumRooms
      whereSql += ' AND NoRooms >= ? '
      whereProps.push +req.body.MinimumRooms
    if req.body.MaximumRooms
      whereSql += ' AND NoRooms <= ? '
      whereProps.push +req.body.MaximumRooms
    if not req.body.IncludeStc
      whereSql += ' AND stc=false '
    if req.body.RoleType
      whereSql += ' AND RoleType->SystemName = ? '
      whereProps.push req.body.RoleType
    if req.body.RoleStatus
      whereSql += ' AND RoleStatus->SystemName = ? '
      whereProps.push req.body.RoleStatus
    if req.body.Search
      whereSql += " AND SearchField LIKE '%#{req.body.Search.replace("'", '')}%' "
    sortby = 'Price->PriceValue'
    sortdir = 1
    limit = 0
    skip = 0
    if req.body.SortBy
      sortby = req.body.SortBy.replace '.', '->'
    if req.body.SortDir
      sortdir = req.body.SortDir
    if req.body.PageSize
      limit = +req.body.PageSize
    if req.body.PageNumber
      skip = ((+req.body.PageNumber - 1) * limit) + 1
    totalProps = ndx.database.exec "SELECT * FROM props WHERE #{whereSql}", whereProps
    total = totalProps.length
    orderby = " ORDER BY #{sortby} #{if sortdir is 1 then 'ASC' else 'DESC'} "
    paging = " LIMIT #{limit} OFFSET #{skip} "
    props = ndx.database.exec "SELECT * FROM props WHERE #{whereSql} #{orderby} #{paging}", whereProps
    res.json
      TotalCount: total
      CurrentCount: props.length
      PageSize: limit
      PageNumber: Math.floor((skip - 1) / limit) + 1
      Collection: props
  ndx.app.get '/api/property/:id', (req, res) ->
    if req.params.id
      props = ndx.database.exec 'SELECT * FROM props WHERE RoleId=?', [+req.params.id]
      if props and props.length
        property = props[0]
        similar = []
        if property.RoomCountsDescription and property.RoomCountsDescription.Bedrooms and property.PropertyType and property.RoleStatus
          similar = ndx.database.exec 'SELECT * FROM props WHERE RoomCountsDescription->Bedrooms=? AND PropertyType->SystemName=? AND RoleType->SystemName=? AND RoleStatus->SystemName!=? LIMIT 4', [
            property.RoomCountsDescription.Bedrooms
            property.PropertyType.SystemName
            property.RoleType.SystemName
            'InstructionToSell'
          ]
        superagent.get "#{apiUrl}#{req.params.id}?APIKey=#{apiKey}"
        .set 'Rezi-Api-Version', '1.0'
        .send()
        .end (err, response) ->
          if not err and response.body
            response.body.similar = similar
          res.json response.body
      else
        throw
          status: 200
          message: 'no property found'
    else
      throw
        status: 200
        message: 'no id'