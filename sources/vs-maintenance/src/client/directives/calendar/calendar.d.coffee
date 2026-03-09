'use strict'

angular.module 'vs-maintenance'
.directive 'calendar', ($timeout, $filter, $rootScope, TaskPopup) ->
  restrict: 'EA'
  templateUrl: 'directives/calendar/calendar.html'
  replace: true
  link: (scope, elem, attrs) ->
    dayOffset = 7
    daysToShow = 5
    if window.innerWidth < 820
      dayOffset = 1
      daysToShow = 1
    resize = ->
      dayOffset = 7
      daysToShow = 5
      if window.innerWidth < 820
        dayOffset = 1
        daysToShow = 1
      $timeout ->
        generateData scope.startDate
    window.addEventListener 'resize', resize
    mapTasksToDays = ->
      if scope.tasks and scope.tasks.items
        for week in scope.weeks
          for day in week.days
            day.tasks = []
            for task in scope.tasks.items
              taskDate = new Date task.date
              if day.day.getDate() is taskDate.getDate() and day.day.getMonth() is taskDate.getMonth() and day.day.getFullYear() is taskDate.getFullYear()
                task.date = taskDate
                task.duration = new Date task.duration
                dayDate = new Date day.day.getFullYear(), day.day.getMonth(), day.day.getDate(), 9
                task.top = (taskDate.valueOf() - dayDate.valueOf()) / 3600000 * 6
                task.height = task.duration.valueOf() / 3600000 * 6
                day.tasks.push task
    scope.calculateDailyIncome = (day) ->
      output =
        amount: 0
        target: 130
        profitloss: 0
      if scope.tasks and scope.tasks.items
        for task in $filter('filter')(scope.tasks.items, scope.selectedUser)
          if task.status is 'confirmed' or task.status is 'completed'
            taskDate = new Date task.date
            if day.getDate() is taskDate.getDate() and day.getMonth() is taskDate.getMonth() and day.getFullYear() is taskDate.getFullYear()
              output.amount += +(task.cost or 0)
      output.profitloss = output.amount - output.target
      output
    scope.calculateWeeklyIncome = ->
      weekStart = startDate
      output =
        amount: 0
        target: 5 * 130
        profitloss: 0
        jobs: 0
        quotes: 0
      weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7)
      if scope.tasks and scope.tasks.items
        for task in $filter('filter')(scope.tasks.items, scope.selectedUser)
          taskDate = new Date task.date
          if weekStart.valueOf() < taskDate.valueOf() < weekEnd.valueOf()
            output.jobs++
            if task.status is 'confirmed' or task.status is 'completed'
              output.amount += +(task.cost or 0)
            else if task.status is 'quote'
              output.quotes++
      output.profitloss = output.amount - output.target
      output
    scope.tasks = scope.list 'tasks', null, ->
      mapTasksToDays()
    getTasks = (date, time) ->
      date = new Date date.getFullYear(), date.getMonth(), date.getDate(), 9
      statuses = ['confirmed', 'quote', 'completed']
      taskDate = new Date date.getFullYear(), date.getMonth(), date.getDate(), time
      [{
        title: 'dgoijd godijg dsoigjds gjsdiogj dsojg sdoigj sdoigjsdoi gjodsigj sdiojgosdij gosdijg osdigj oijg osdijg osdigj ij g'
        date: taskDate
        top: (taskDate.valueOf() - date.valueOf()) / 3600000 * 6
        height: 3600000 / 3600000 * (3 * Math.floor(Math.random() * 6) + 3)
        status: statuses[Math.floor(Math.random() * statuses.length)]
        duration: new Date(3600000)
      }]
    scope.weeks = []
    startDate = new Date()
    selectedDate = startDate
    deref = $rootScope.$on 'toolbar:date-tap', (e, date) ->
      startDate = new Date date
      selectedDate = startDate
      while startDate.getDay() isnt 1
        startDate = new Date(startDate.valueOf() - 24 * 60 * 60 * 1000)
      generateData startDate
    scope.$on '$destroy', ->
      deref()
      window.removeEventListener 'resize', resize
    makeWeek = (startDate) ->
      week =
        date: startDate
        days: []
      i = 0
      while i++ < daysToShow
        hours = []
        startDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 9)
        j = 0
        while j++ < 12
          hours.push startDate
          startDate = new Date(startDate.valueOf() + 60 * 60 * 1000)
        week.days.push 
          day: startDate
          tasks: []#getTasks startDate, i + 9
          hours: hours
        startDate = new Date(startDate.valueOf() + 24 * 60 * 60 * 1000)
      week
    generateData = (startDate) ->
      TaskPopup.hide()
      scope.startDate = startDate
      scope.weeks = [
        makeWeek new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() - dayOffset)
        makeWeek startDate
        makeWeek new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + dayOffset)
      ]
      mapTasksToDays()
    while startDate.getDay() isnt 1
      startDate = new Date(startDate.valueOf() - 24 * 60 * 60 * 1000)
    $timeout ->
      generateData startDate
    scope.isSelected = (day) ->
      if day.getDate() is selectedDate.getDate() and day.getMonth() is selectedDate.getMonth() and day.getFullYear() is selectedDate.getFullYear()
        return true
      false
    scope.openTask = (task, ev) ->
      if TaskPopup.getHidden()
        task = task or {}
        task.duration = task.duration or new Date 3600000
        task.assignedTo = task.assignedTo or scope.selectedUser
        task.status = task.status or 'quote'
        task.createdDate = task.createdDate or new Date().valueOf()
        task.createdBy = task.createdBy or scope.auth.getUser()
        scope.modal
          template: 'task'
          controller: 'TaskCtrl'
          data: 
            task: task
            maintenance: scope.maintenance
        .then (result) ->
          true
        , (err) ->
          false
      else
        TaskPopup.cancelBubble = false
        #ev.stopPropagation()
      
    #swiper stuff
    swiper = angular.element(elem[0])
    carousel = angular.element(elem[0].querySelector('.carousel'))
    hammerSwiper = new Hammer(elem[0])
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
      
    scope.prev = ->
      scope.snap =
        key: 0
        value: 0
      snapTo()
    scope.next =->
      scope.snap =
        key: 2
        value: -200
      snapTo()
    scope.goToToday = ->
      startDate = new Date()
      selectedDate = startDate
      while startDate.getDay() isnt 1
        startDate = new Date(startDate.valueOf() - 24 * 60 * 60 * 1000)
      generateData startDate

    snapTo = ->
      carousel.removeClass('dragging').addClass('animate').css transform: 'translate3d(' + scope.snap.value + '%, 0, 0)'
      if scope.snap.key isnt 1
        $timeout ->
          if scope.snap.key is 0
            startDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() - dayOffset)
          if scope.snap.key is 2
            startDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + dayOffset)
          generateData startDate
          scope.snap = _snaps[1]
          carousel.removeClass('animate').css transform: 'translate3d(' + scope.snap.value + '%, 0, 0)'
        , 300

    # HAMMER TIME
    hammerSwiper.get('pan').set
      direction: Hammer.DIRECTION_HORIZONTAL
      threshold: 0
    hammerSwiper.on('panstart', ->
      carousel.addClass('dragging').removeClass 'animate'
      swiper.addClass 'dragging'
      return
    ).on('panleft panright', (e) ->
      d = if Math.abs(parseInt(e.deltaX)) > Math.abs(parseInt(e.deltaY)) then 'x' else 'y'
      x = scope.snap.value + parseInt(e.deltaX) / elem[0].clientWidth * 100 * scope.mod
      y = parseInt(e.deltaY) / elem[0].clientHeight * 100 * scope.mod
      y = 0#if y < 0 then 0 else y
      if d == 'x'
        carousel.css transform: 'translate3d(' + x + '%, 0, 0)'
      else
        swiper.css transform: 'translate3d(0, ' + y + '%, 0)'
      return
    ).on 'panend', ->
      swiper.removeClass('dragging').css transform: ''
      if d == 'x'
        scope.snap = _calculateSnapPoint(x)
        #_setMonths scope.snap
        #scope.snap = _snaps[1]
        snapTo()
      scope.$apply()
      return
    scope.mod = 1.5
    scope.snap = _snaps[1]
    carousel.css transform: 'translate3d(' + scope.snap.value + '%, 0, 0)'
