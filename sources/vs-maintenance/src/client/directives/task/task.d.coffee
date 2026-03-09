'use strict'

angular.module 'vs-maintenance'
.directive 'task', (TaskPopup) ->
  restrict: 'EA'
  templateUrl: 'directives/task/task.html'
  replace: true
  link: (scope, elem, attrs) ->
    scope.openTask = (task, ev) ->
      TaskPopup.setTask task
      TaskPopup.show elem
      ev.stopPropagation()
      ###
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
      ###