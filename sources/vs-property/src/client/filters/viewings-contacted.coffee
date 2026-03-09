'use strict'

angular.module 'vsProperty'
.filter 'viewingContacted', ->
  (property) ->
    nocompleted = 0
    for viewing in property.viewings
      if viewing.EventStatus.Name is 'Completed'
        nocompleted++
    nocompleted