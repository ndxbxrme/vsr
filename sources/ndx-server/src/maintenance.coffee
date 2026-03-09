'use strict'

module.exports = (options) ->
  database = options.database
  (req, res, next) ->
    if database.maintenance()
      if req.originalUrl is '/maintenance-off' or req.originalUrl is '/api/upload/database' or req.originalUrl is '/api/getdb'
        next()
      else
        res.end 'Database maintenance time, please come back later'
    else
      next()