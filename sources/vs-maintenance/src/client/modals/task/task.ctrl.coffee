'use strict'

angular.module 'vs-maintenance'
.controller 'TaskCtrl', ($scope, $rootScope, $http, $window, $timeout, ndxModalInstance, Upload, alert, Property, data) ->
  $scope.jobs = []
  $scope.forms = {}
  $scope.getProperties =  Property.getProperties
  $scope.task = Object.assign {}, data.task
  $scope.maintenance = data.maintenance
  $scope.statuses = [
    {
      id: 'quote',
      name: 'Quote'
    },
    {
      id: 'confirmed',
      name: 'Confirmed'
    },
    {
      id: 'completed',
      name: 'Completed'
    }
  ]
  $scope.jobtypes = $scope.single 'jobtypes',
    type: 'default'
  , (jobtypes) ->
    if jobtypes and jobtypes.item and jobtypes.item.jobs
      $timeout ->
        $scope.jobs = jobtypes.item.jobs.trim().split('\n')
  $scope.setDate = ->
    $rootScope.$emit 'swiper:show', $scope.task.date
  deref = $rootScope.$on 'set-date', (e, date) ->
    sel = new Date date
    $scope.task.date = new Date sel.getFullYear(), sel.getMonth(), sel.getDate(), $scope.task.date.getHours(), $scope.task.date.getMinutes()
  $scope.$on '$destroy', ->
    deref()
  $scope.cancel = ->
    ndxModalInstance.dismiss()
  $scope.save = ->
    $scope.submitted = true
    if $scope.forms.myForm.$valid or $scope.task.status is 'quote'
      property = Property.getProperty $scope.task.property
      $scope.task.title = "#{$scope.task.job}, #{$scope.task.property}"
      $scope.task.dateVal = $scope.task.date.valueOf()
      $http.post "/api/tasks/#{$scope.task._id or ''}", $scope.task
      .then (response) ->
        ndxModalInstance.dismiss()
      , (err) ->
        false
  $scope.delete = ->
    if $window.confirm 'Are you sure you want to delete this task?'
      $http.delete "/api/tasks/#{$scope.task._id}"
      .then (response) ->
        ndxModalInstance.dismiss()
      , (err) ->
        false

  $scope.deleteDocument = (document) ->
    if $window.confirm 'Are you sure you want to delete this document?'
      $scope.task.documents.splice $scope.task.documents.indexOf(document), 1
      alert.log 'Document deleted'
  $scope.uploadFiles = (files, errFiles) ->
    if files
      Upload.upload
        url: '/api/upload'
        data:
          file: files
          user: $scope.auth.getUser()
      .then (response) ->
        if response.data
          $scope.uploadProgress = 0
          if not $scope.task.documents
            $scope.task.documents = []
          for document in response.data
            $scope.task.documents.push document
          alert.log 'Document uploaded'
      , (err) ->
        false
      , (progress) ->
        $scope.uploadProgress = Math.min 100, parseInt(100.0 * progress.loaded / progress.total)
  $scope.makeDownloadUrl = (document) ->
    '/api/download/' + btoa "#{JSON.stringify({path:document.path,filename:document.originalFilename})}"