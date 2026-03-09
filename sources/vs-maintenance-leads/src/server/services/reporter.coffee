superagent = require 'superagent'

module.exports = (ndx) ->
  ndx.reporter =
    log: (report) ->
      try
        superagent.post process.env.REPORT_URL
        .send
          report: report
        .end (err, response) ->
          console.log 'log posted'
      catch e
        #do nothing