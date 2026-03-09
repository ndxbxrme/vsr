'use strict'

angular.module 'vsProperty'
.filter 'getFeedbackCount', ->
  (property) ->
    count = 0
    for viewing in property.viewings
      count += viewing.Feedback.length
    count