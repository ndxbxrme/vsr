'use strict'

angular.module 'ndx'
.filter 'byStatus', ->
  (input, filters) ->
    if input and filters
      hasFilter = false
      for key of filters
        if filters[key]
          hasFilter = true
          break
      if not hasFilter
        return input
      output = []
      for item in input
        if filters[item.status]
          output.push item
      return output
    input