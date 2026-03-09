'use strict'

angular.module 'vs-maintenance'
.directive 'taskPopup', ($http, alert, TaskPopup) ->
  restrict: 'EA'
  templateUrl: 'directives/task-popup/task-popup.html'
  replace: true
  link: (scope, elem, attrs) ->
    scope.getTask = TaskPopup.getTask
    scope.getHidden = TaskPopup.getHidden
    scope.getDateTo = ->
      task = TaskPopup.getTask()
      if task
        new Date(task.date.valueOf() + task.duration.valueOf())
    scope.save = ->
      $http.post "/api/tasks/#{scope.getTask()._id or ''}", scope.getTask()
      .then (response) ->
        alert.log 'Task updated'
      , (err) ->
        false
    scope.complete = ->
      scope.getTask().status = 'completed'
      scope.save()
    scope.edit = (task) ->
      TaskPopup.hide()
      scope.modal
        template: 'task'
        controller: 'TaskCtrl'
        data: 
          task: task
          maintenance: scope.maintenance
      .then (response) ->
        true
      , (err) ->
        false