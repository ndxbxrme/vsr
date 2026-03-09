(($angular, $moment, _, Hammer) ->
  'use strict'
  $angular.module('date-swiper', []).directive('tap', [ ->
    (scope, element, attr) ->
      hammerTap = new Hammer(element[0], {})
      hammerTap.on 'tap', (ev) ->
        scope.$event = ev
        scope.$apply ->
          scope.$eval attr.tap
          return
        return
      return
 ]).directive 'dateSwiper', [
    '$rootScope'
    '$timeout'
    ($rootScope, $timeout) ->
      me = {}
      me.dFormat = 'YYYY-MM-DD'
      me.today = $moment().format(me.dFormat)

      me._buildDayObject = (y, m, d) ->
        _d = $moment([
          y
          m
          d
        ])
        {
          num: _d.date()
          date: _d.format(me.dFormat)
          weekday: _d.weekday()
          month: m
        }

      me._calendarData = (date) ->
        _key = $moment(date).startOf('month')
        # setup 'current' month days
        d = []
        d = _.times(_key.daysInMonth(), (n) ->
          me._buildDayObject _key.year(), _key.month(), n + 1
        )
        # setup prev month backfill days
        _p = $moment(_key).subtract(1, 'month')
        _pd = []
        pd = []
        _pi = 0
        _pj = _p.daysInMonth()
        while _pi < _key.isoWeekday()
          _pd.unshift _pj
          _pi++
          _pj--
        pd = _.times(_pd.length, (i) ->
          me._buildDayObject _p.year(), _p.month(), _pd[i]
        )
        # setup next month postfill days
        _n = $moment(_key).add(1, 'month')
        _nsd = 1
        _t = 0
        _nd = []
        nd = []
        _t = d.length + _pd.length
        while _t % 14 != 0
          _nd.push _nsd
          _nsd++
          _t++
        nd = _.times(_nd.length, (i) ->
          me._buildDayObject _n.year(), _n.month(), _nd[i]
        )
        {
          days: pd.concat(d).concat(nd)
          year: _key.year()
          month: _key.month()
          monthName: _key.format('MMMM')
        }

      # construct calendar data for 3 months: current/given month, previous, and next

      me._generateMonths = (date) ->
        m = []
        date = if $moment(date).isValid() then $moment(date).valueOf() else $moment().valueOf()
        m.push me._calendarData($moment(date).subtract(1, 'month'))
        m.push me._calendarData($moment(date))
        m.push me._calendarData($moment(date).add(1, 'month'))
        m

      me._tryFuzzyDates = (date) ->
        if date == 'today'
          date = me.today
        else if date == 'tomorrow'
          date = $moment(me.today).add(1, 'day')
        else if date == 'yesterday'
          date = $moment(me.today).subtract(1, 'day')
        date

      me._setActiveDate = (date) ->
        date = me._tryFuzzyDates(date)
        if $moment(date).isValid() then $moment(date).format(me.dFormat) else null

      {
        restrict: 'E'
        replace: true
        scope:
          config: '=?'
          date: '=?'
        templateUrl: 'directives/date-swiper/date-swiper.html'
        link: (scope, element) ->
          signature = scope.config.prefix or 'date-swiper'
          swiper = $angular.element(element[0])
          carousel = $angular.element(element[0].querySelector('.carousel'))
          hammerSwiper = new Hammer(swiper[0])
          d = undefined
          x = 0
          y = 0
          _snaps = [
            {
              key: 0
              value: 0
            }
            {
              key: 1
              value: -100
            }
            {
              key: 2
              value: -200
            }
          ]
          # get the snap location at 'panend' for where to animate the carousel

          _calculateSnapPoint = (pos) ->
            diff = undefined
            # difference between pos and snap value
            min = undefined
            # smallest difference
            key = undefined
            # best snap key
            value = undefined
            # best snap value
            # loop to find smallest diff, it is closest to the pos
            _.times 3, (n) ->
              snap = if n > 0 then n * -100 else 0
              diff = Math.abs(pos - snap)
              if _.isUndefined(min) or diff < min
                min = diff
                key = n
                value = snap
              return
            {
              key: key
              value: value
            }

          _setMonths = (snap) ->
            _c = scope.months[snap.key]
            carousel.removeClass('dragging').addClass('animate').css transform: 'translate3d(' + snap.value + '%, 0, 0)'
            # center active date, regenerate calendars
            if snap.key != 1
              $timeout (->
                scope.months = me._generateMonths($moment([
                  _c.year
                  _c.month
                ]).valueOf())
                scope.snap = _snaps[1]
                carousel.removeClass('animate').css transform: 'translate3d(' + scope.snap.value + '%, 0, 0)'
                return
              ), 300
            return

          # STUFF ON SCOPE
          # user clicks date to make it "active"

          scope.setDate = (date) ->
            scope.date = me._setActiveDate(date)
            scope.months = me._generateMonths(scope.date)
            _setMonths scope.snap
            $rootScope.$emit signature + ':date-tap', scope.date
            return

          # Calculate the classes for the calendar items.

          scope.setClass = (day, month) ->
            classes = []
            if day.date == scope.date
              classes.push 'is-selected'
            if day.date == me.today
              classes.push 'is-today'
            if day.weekday == 0 or day.weekday == 6
              classes.push 'is-weekend'
            if day.month == month.month
              classes.push 'day-in-curr-month'
            classes.join ' '

          scope.toggle = ->
            scope.config.show = !scope.config.show
            return
            
          scope.monthPrev = ->
            scope.snap =
              key: 0
              value: 0
            _setMonths scope.snap
          scope.monthNext = ->
            scope.snap =
              key: 2
              value: -200
            _setMonths scope.snap
          scope.done = ->
            $rootScope.$emit 'set-date', scope.date
            scope.config.show = false

          # HAMMER TIME
          hammerSwiper.get('pan').set
            direction: Hammer.DIRECTION_ALL
            threshold: 0
          hammerSwiper.on('panstart', ->
            carousel.addClass('dragging').removeClass 'animate'
            swiper.addClass 'dragging'
            return
          ).on('panleft panright panup pandown', (e) ->
            d = if Math.abs(parseInt(e.deltaX)) > Math.abs(parseInt(e.deltaY)) then 'x' else 'y'
            x = scope.snap.value + parseInt(e.deltaX) / element[0].clientWidth * 100 * scope.mod
            y = parseInt(e.deltaY) / element[0].clientHeight * 100 * scope.mod
            y = if y < 0 then 0 else y
            if d == 'x'
              carousel.css transform: 'translate3d(' + x + '%, 0, 0)'
            ###
            else
              swiper.css transform: 'translate3d(0, ' + y + '%, 0)'
            ###
            return
          ).on 'panend', ->
            swiper.removeClass('dragging').css transform: ''
            if d == 'x'
              scope.snap = _calculateSnapPoint(x)
              _setMonths scope.snap
            ###
            if d == 'y' and y > 35
              scope.toggle()
            ###
            scope.$apply()
            return
          # LISTEN FOR THINGS
          $rootScope.$on signature + ':set', (e, date) ->
            scope.setDate date
            return
          $rootScope.$on signature + ':show', (e, date) ->
            scope.config.show = true
            scope.setDate date
            return
          $rootScope.$on signature + ':hide', ->
            scope.config.show = false
            return
          # DO THINGS

          init = (date) ->
            scope.dayNames = [
              'Sun'
              'Mon'
              'Tue'
              'Wed'
              'Thu'
              'Fri'
              'Sat'
            ]
            scope.mod = if parseFloat(scope.config.modifier) < 0.75 then 0.75 else parseFloat(scope.config.modifier)
            scope.snap = _snaps[1]
            scope.setDate date
            return

          init scope.date
          return

      }
  ]
  return
) window.angular, window.moment, window._, window.Hammer

# ---
# generated by js2coffee 2.2.0