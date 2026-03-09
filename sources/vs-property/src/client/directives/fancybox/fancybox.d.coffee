'use strict'

angular.module 'vsProperty'
.directive 'fancybox', ($timeout) ->
  restrict: 'A'
  link: (scope, element, attrs) ->
    $timeout ->
      $(element).fancybox
        openEffect: 'fade'
        closeEffect: 'fade'
        prevEffect: 'fade'
        nextEffect: 'fade'
        padding: 0
        helpers:
          overlay:
            locked: false
    , 0
