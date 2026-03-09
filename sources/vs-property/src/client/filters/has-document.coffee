'use strict'

angular.module 'vsProperty'
.filter 'hasDocument', ->
  (property, docName) ->
    if property.details.Documents and property.details.Documents.length
      for document in property.details.Documents
        if document.DocumentSubType.DisplayName is docName
          return 'Yes'
    'No'