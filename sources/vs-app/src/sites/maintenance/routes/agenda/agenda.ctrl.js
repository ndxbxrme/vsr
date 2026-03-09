angular.module('vs-maintenance').controller('maintenanceAgendaCtrl', function($scope, $compile, $timeout, $filter, MaintenanceTaskPopup) {
  'use strict';

  var userFormat = function(data) {
    if (!$scope.users) return;
    var user = $scope.selectById($scope.users.items, data.id);
    if (user) {
      return $compile('<img gravatar-src=\'"' + user.local.email + '"\' /> <span>' + (user.displayName || user.local.email) + '</span>')($scope);
    }
  };
  $scope.userSelectOptions = {
    minimumResultsForSearch: Infinity,
    formatResult: userFormat,
    formatSelection: userFormat,
    theme: 'usertheme',
    containerCssClass: ':all:'
  };
  $scope.hidePopup = function() {
    return MaintenanceTaskPopup.hide();
  };

  var WINDOW = 14;
  var startOffset = 0;

  $scope.filters = {
    confirmed: false,
    quote: false,
    completed: false
  };

  $scope.setFilters = function() { /* ng-change hook */ };

  $scope.today = new Date();

  $scope.isToday = function(date) {
    var t = new Date();
    return date.getDate() === t.getDate() &&
           date.getMonth() === t.getMonth() &&
           date.getFullYear() === t.getFullYear();
  };

  var buildDays = function() {
    var base = new Date();
    var windowStart = new Date(base.getFullYear(), base.getMonth(), base.getDate() + startOffset * WINDOW);
    var days = [];
    for (var i = 0; i < WINDOW; i++) {
      var d = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate() + i);
      days.push({
        date: d,
        tasks: [],
        income: { amount: 0 }
      });
    }
    $scope.days = days;
    $scope.windowStart = windowStart;
    $scope.windowEnd = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate() + WINDOW - 1);
    mapTasks();
  };

  var mapTasks = function() {
    if (!$scope.tasks || !$scope.tasks.items) return;
    $scope.days.forEach(function(day) {
      day.tasks = [];
      day.income = { amount: 0 };
      $scope.tasks.items.forEach(function(task) {
        var td = new Date(task.date);
        if (td.getDate() === day.date.getDate() &&
            td.getMonth() === day.date.getMonth() &&
            td.getFullYear() === day.date.getFullYear()) {
          day.tasks.push(task);
          if (task.status === 'confirmed' || task.status === 'completed') {
            day.income.amount += +(task.cost || 0);
          }
        }
      });
      day.tasks.sort(function(a, b) { return new Date(a.date) - new Date(b.date); });
    });
  };

  $scope.prev = function() {
    startOffset--;
    buildDays();
  };

  $scope.next = function() {
    startOffset++;
    buildDays();
  };

  $scope.goToToday = function() {
    startOffset = 0;
    buildDays();
  };

  $scope.taskHasImages = function(task) {
    return task.documents && task.documents.some(function(d) {
      return d.basetype === 'image' || d.basetype === 'video';
    });
  };

  $scope.taskHasDocs = function(task) {
    return task.documents && task.documents.some(function(d) {
      return d.basetype !== 'image' && d.basetype !== 'video';
    });
  };

  $scope.openDocs = function(task, $event) {
    $event.stopPropagation();
    (task.documents || []).forEach(function(d) {
      if (d.basetype !== 'image' && d.basetype !== 'video') {
        var url = $scope.makeDownloadUrl('maintenance', d);
        fetch(url)
          .then(function(res) { return res.blob(); })
          .then(function(blob) {
            var blobUrl = URL.createObjectURL(blob);
            window.open(blobUrl, '_blank');
          });
      }
    });
  };

  $scope.showLightbox = function(task, $event) {
    $event.stopPropagation();
    var media = (task.documents || [])
      .filter(function(d) { return d.basetype === 'image' || d.basetype === 'video'; })
      .map(function(d) { return { URL: $scope.makeDownloadUrl('maintenance', d) }; });
    if (!media.length) return;
    $scope.modal({
      template: require('../../modals/lightbox/lightbox.html').default,
      controller: 'maintenanceLightboxCtrl',
      size: 'large',
      data: media
    });
  };

  $scope.openTask = function(task, day, ev) {
    MaintenanceTaskPopup.hide();
    task = task || {};
    task.date = task.date || day.date;
    task.duration = task.duration || new Date(3600000);
    task.assignedTo = task.assignedTo || $scope.selectedUser;
    task.status = task.status || 'quote';
    task.createdDate = task.createdDate || new Date().valueOf();
    task.createdBy = task.createdBy || $scope.auth.getUser();
    $scope.modal({
      template: require('../../modals/task/task.html').default,
      controller: 'maintenanceTaskCtrl',
      data: {
        task: task,
        maintenance: $scope.maintenance
      }
    }).then(function() { buildDays(); }, function() { buildDays(); });
  };

  $scope.tasks = $scope.list('maintenance:tasks', null, function(tasks) {
    var aMonthAgo = new Date().setMonth(new Date().getMonth() - 6);
    tasks.items = tasks.items.filter(function(task) {
      return new Date(task.date) > aMonthAgo;
    });
    buildDays();
  });

  buildDays();
});
