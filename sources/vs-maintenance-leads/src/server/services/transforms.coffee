'use strict'

module.exports = (ndx) ->
  ndx.rest.selectTransform = (user, table, all, transforms) ->
    if all
      transforms.all
    else
      null
  ndx.rest.transforms =
    all:
      "objtrans-filter":
        test: true