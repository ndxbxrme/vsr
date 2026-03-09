'use strict'

angular.module 'vs-maintenance'
.factory 'TaskPopup', ($timeout) ->
  task = null
  elem = null
  hidden = true
  cancelBubble = false
  getOffset = (elm) ->
    offset =
      left: 0
      top: 0
    while elm and elm.tagName isnt 'BODY'
      offset.left += elm.offsetLeft
      offset.top += elm.offsetTop
      elm = elm.offsetParent
    offset
  moveToElem = ->
    if elem
      offset = getOffset(elem)
      offset.top += elem.clientHeight
      offset.left -= +$('.calendar-dir').width()
      elemLeft = offset.left
      popupWidth = $('.task-popup-dir').width()
      popupHeight = $('.task-popup-dir .popup').height()
      calendarOffset = getOffset $('.calendar-dir')[0]
      pointerTop = '.75rem'
      pointerBottom = 'auto'
      if offset.top + popupHeight > calendarOffset.top + $('.calendar-dir').height()
        offset.top -= elem.clientHeight + popupHeight + 48
        pointerTop = 'auto'
        pointerBottom = '.75rem'
      if offset.left + (popupWidth + 20) > window.innerWidth
        offset.left = window.innerWidth - (popupWidth + 10)
      offset.left -= 20
      if offset.left < 2
        offset.left = 2
      if window.innerWidth < 410
        offset.left = 2
      $('.task-popup-dir').css offset
      pointerLeft = elemLeft - offset.left + 10
      pointerDisplay = 'block'
      if pointerLeft + 40 > popupWidth
        pointerDisplay = 'none'
      $('.task-popup-dir .pointer').css
        top: pointerTop
        bottom: pointerBottom
        left: pointerLeft
        display: pointerDisplay
  window.addEventListener 'resize', moveToElem
  setTask: (_task) ->
    task = _task
  getTask: ->
    task
  show: (_elem) ->
    console.log 'showing'
    hidden = false
    elem = _elem[0]
    $timeout ->
      moveToElem()
  hide: ->
    hidden = true
  getHidden: ->
    hidden
  cancelBubble: cancelBubble