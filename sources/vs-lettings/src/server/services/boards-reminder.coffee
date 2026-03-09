dateFnsTz = require 'date-fns-tz'
{ zonedTimeToUtc, utcToZonedTime, format } = dateFnsTz

millisecondsUntil11am = ->
  now = new Date
  timeZone = 'Europe/London'
  # Time zone for the United Kingdom
  # Convert the current time to the UK time zone
  nowInUKTimeZone = utcToZonedTime(now, timeZone)
  elevenAM = new Date(nowInUKTimeZone)
  elevenAM.setHours 11, 0, 0, 0
  if nowInUKTimeZone.getHours() >= 11 or nowInUKTimeZone.getTime() > elevenAM.getTime()
    elevenAM.setDate elevenAM.getDate() + 1
  # Format the dates for display
  formatOptions = 
    timeZone: timeZone
    hour: '2-digit'
    minute: '2-digit'
  elevenAMString = format(elevenAM, 'HH:mm', formatOptions)
  nowString = format(nowInUKTimeZone, 'HH:mm', formatOptions)
  elevenAM.getTime() - nowInUKTimeZone.getTime()

module.exports = (ndx) ->
  ndx.database.on 'ready', ->
    sendEmail = ->
      if new Date().getDay() is 3
        ndx.database.select 'emailtemplates',
          name: 'Auto Reminder - Boards'
        , (templates) -> 
          if templates and templates.length
            users = ['lettings@vitalspace.co.uk', 'sales@vitalspace.co.uk']
            for user in users
              templates[0].to = user
              ndx.email.send templates[0]
      setTimeout sendEmail, millisecondsUntil11am()
    setTimeout sendEmail, millisecondsUntil11am()    