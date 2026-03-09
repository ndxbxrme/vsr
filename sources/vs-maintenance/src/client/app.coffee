'use strict'

angular.module 'vs-maintenance', [
  'ndx'
  'ui.router'
  'ui.gravatar'
  'ui.select2'
  'date-swiper'
  'ngFileUpload'
  'ng-sumoselect'
]
.config ($locationProvider, $urlRouterProvider, gravatarServiceProvider) ->
  gravatarServiceProvider.defaults =
    size: 24
    "default": 'mm'
    rating: 'pg'
  $urlRouterProvider.otherwise '/'
  $locationProvider.html5Mode true
.run ($rootScope, ndxModal, $state, $timeout, TaskPopup, Auth) ->
  root = Object.getPrototypeOf $rootScope
  root.generateId = (len) ->
    letters = "abcdefghijklmnopqrstuvwxyz0123456789"
    output = ''
    i = 0
    while i++ < len
      output += letters[Math.floor(Math.random() * letters.length)]
    output
  root.modal = (args) ->
    size = args.size or 'large'
    controller = args.controller or 'YesNoCancelCtrl'
    backdrop = args.backdrop or 'static'
    modalInstance = ndxModal.open
      templateUrl: "modals/#{args.template}/#{args.template}.html"
      windowClass: size
      controller: controller
      backdrop: backdrop
      resolve:
        data: ->
          args.data
    modalInstance.result
  root.state = (state) ->
    $state.is state
  root.selectById = (list, id) ->
    output = null
    if list and list.length
      for item in list
        if item._id is id
          output = item
          break
    output
  Auth.onUser ->
    root.users = $rootScope.list 'users', null, (users) ->
      root.maintenance = []
      root.staff = []
      for user in users.items
        if user.roles
          if user.roles.maintenance
            root.maintenance.push user
            if not $rootScope.selectedUser
              $rootScope.selectedUser = user
          if user.roles.agency
            root.staff.push user
  $rootScope.bodyTap = (e) ->
    $rootScope.mobileMenuOut = false
    elm = e.target
    isPopup = false
    while elm and elm.tagName isnt 'BODY'
      if elm.className is 'popup'
        isPopup = true
        break
      elm = elm.parentNode
    if not isPopup
      if not TaskPopup.getHidden()
        TaskPopup.hide()
        TaskPopup.cancelBubble = true
try
  angular.module 'ndx'
catch e
  angular.module 'ndx', [] #ndx module stub