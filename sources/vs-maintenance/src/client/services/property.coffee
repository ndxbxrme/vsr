'use strict'

angular.module 'vs-maintenance'
.factory 'Property', ($http, env) ->
  properties = []
  fetchProperties = ->
    async.parallel [
      (callback) ->
        callback null, [{
          RoleId: 'vitalspace-office'
          displayAddress: 'Vitalspace Office'
          Address: {
            Street: 0
          }
        }]
      (callback) ->
        $http
          method: 'POST'
          url: "#{env.PROPERTY_URL}/search"
          headers:
            Authorization: "Bearer #{env.PROPERTY_TOKEN}"
          data:
            IncludeStc: true
            RoleType: 'Letting'
        .then (response) ->
          callback null, response.data.Collection
        , (err) ->
          callback err
    ]
    , (err, results) ->
      if not err
        properties = []
        for props in results
          properties = properties.concat props
  fetchProperties: fetchProperties
  getProperties: ->
    properties
  getProperty: (roleId) ->
    for property in properties
      if property.RoleId.toString() is roleId
        return property
    return null
.run (Property) ->
  Property.fetchProperties()