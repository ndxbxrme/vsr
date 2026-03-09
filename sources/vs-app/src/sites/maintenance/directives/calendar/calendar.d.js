angular.module('vs-maintenance')
.directive('maintenanceCalendar', ($timeout, $filter, $rootScope, MaintenanceTaskPopup) => {
  return {
    restrict: 'EA',
    template: require('./calendar.html').default,
    replace: true,
    link: (scope, elem, attrs) => {
      let startDate = new Date();
      let selectedDate = new Date(startDate);
      while(startDate.getDay()!==1)
        startDate = new Date(startDate.valueOf() - 24 * 60 * 60 * 1000);
      let dayOffset = 7;
      let daysToShow = 5;
      const resize = () => {
        dayOffset = 7;
        daysToShow = 5;
        if(window.innerWidth < 820) {
          dayOffset = 1;
          daysToShow = 1;
        }
        if(scope.tasks && scope.tasks.items && scope.tasks.items.length) {
          $timeout(generateData);
        }
      }
      resize();
      window.addEventListener('resize', resize);
      const deref = $rootScope.$on('toolbar:date-tap', (e, date) => {
        startDate = new Date(date);
        selectedDate = new Date(startDate);
        if(dayOffset > 1) {
          while(startDate.getDay()!==1)
            startDate = new Date(startDate.valueOf() - 24 * 60 * 60 * 1000);
        }
        generateData();
      })
      scope.$on('$destroy', () => {
        deref();
        window.removeEventListener('resize', resize);
      });
      scope.calculateDailyIncome = (day) => {
        const output = {
          amount: 0,
          target: 130,
          profitLoss: 0
        };
        if(scope.tasks && scope.tasks.items && scope.tasks.items.length) {
          $filter('filter')(scope.tasks.items, scope.selectedUser).forEach(task => {
            if(['confirmed', 'completed'].includes(task.status)) {
              const taskDate = new Date(task.date);
              if(day.getDate()===taskDate.getDate() && day.getMonth()===taskDate.getMonth() && day.getFullYear()===taskDate.getFullYear()) {
                output.amount += +(task.cost || 0);
              }
            }
          })
        }
        output.profitLoss = output.amount - output.target;
        return output;
      };
      scope.calculateWeeklyIncome = () => {
        let weekStart = startDate;
        while(weekStart.getDay()!==1)
          weekStart = new Date(weekStart.valueOf() - 24 * 60 * 60 * 1000);
        const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7);
        const output = {
          amount: 0,
          target: 5 * 130,
          profitLoss: 0,
          jobs: 0,
          quotes: 0
        }
        if(scope.tasks && scope.tasks.items && scope.tasks.items.length) {
          $filter('filter')(scope.tasks.items, scope.selectedUser).forEach(task => {
            const taskDate = new Date(task.date);
            if(weekStart.valueOf() < taskDate.valueOf() < weekEnd.valueOf()) {
              output.jobs++;
              if(['confirmed', 'completed'].includes(task.status)) {
                output.amount += +(task.cost || 0);
              }
              else if(['quote'].includes(task.status)) {
                output.quotes++;
              }
            }
          })
        }
        output.profitLoss = output.amount - output.target;
        return output;
      };
      const makeWeek = (startDate) => {
        const week = {
          date: startDate,
          days: []
        }
        let i = 0;
        while(i++<daysToShow) {
          const hours = [];
          startDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 9);
          let j = 0;
          while(j++<12) {
            hours.push(startDate);
            startDate = new Date(startDate.valueOf() + 60 * 60 * 1000);
          }
          week.days.push({
            day: startDate,
            tasks: [],
            hours: hours
          })
          startDate = new Date(startDate.valueOf() + 24 * 60 * 60 * 1000);
        }
        return week;
      };
      const mapTasksToDays = () => {
        if(scope.tasks && scope.tasks.items) {
          scope.weeks.forEach(week => {
            week.days.forEach(day => {
              day.tasks = [];
              scope.tasks.items.forEach(task => {
                const taskDate = new Date(task.date);
                if(day.day.getDate()===taskDate.getDate() && day.day.getMonth()===taskDate.getMonth() && day.day.getFullYear()===taskDate.getFullYear()) {
                  task.date = taskDate;
                  task.duration = new Date(task.duration);
                  const dayDate = new Date(day.day.getFullYear(), day.day.getMonth(), day.day.getDate(), 9);
                  task.top = (taskDate.valueOf() - dayDate.valueOf()) / 3600000 * 6;
                  task.height = (task.duration.valueOf() - (task.duration.getTimezoneOffset() * 60 * 1000)) / 3600000 * 6;
                  day.tasks.push(task);
                }
              })
            })
          })
        }
      }
      const generateData = (_startDate) => {
        MaintenanceTaskPopup.hide();
        startDate = _startDate || startDate;
        scope.startDate = startDate;
        scope.weeks = [makeWeek(startDate)];
        mapTasksToDays();
      }
      scope.weeks = [];
      scope.tasks = scope.list('maintenance:tasks', null, (tasks) => {
        const aMonthAgo = new Date().setMonth(new Date().getMonth() - 6);
        tasks.items = tasks.items.filter((task) => new Date(task.date) > aMonthAgo);
        generateData();
      });
      scope.prev = () => {
        startDate = new Date(startDate.valueOf() - dayOffset * 24 * 60 * 60 * 1000);
        generateData();
      }
      scope.next = () => {
        startDate = new Date(startDate.valueOf() + dayOffset * 24 * 60 * 60 * 1000);
        generateData();
      }
      scope.goToToday = () => {
        startDate = new Date();
        selectedDate = new Date(startDate);
        if(dayOffset > 1) {
          while(startDate.getDay()!==1)
            startDate = new Date(startDate.valueOf() - 24 * 60 * 60 * 1000);
        }
        generateData();
      }
      scope.isSelected = (day) => {
        return day.getDate()===selectedDate.getDate() && day.getMonth()===selectedDate.getMonth() && day.getFullYear()===selectedDate.getFullYear();
      }
      scope.openTask = (task, ev) => {
        if (MaintenanceTaskPopup.getHidden()) {
          task = task || {};
          task.duration = task.duration || new Date(3600000);
          task.assignedTo = task.assignedTo || scope.selectedUser;
          task.status = task.status || 'quote';
          task.createdDate = task.createdDate || new Date().valueOf();
          task.createdBy = task.createdBy || scope.auth.getUser();
          scope.modal({
            template: require('../../modals/task/task.html').default,
            controller: 'maintenanceTaskCtrl',
            data: {
              task: task,
              maintenance: scope.maintenance
            }
          }).then((result) => true, (err) => false);
        } else {
          return MaintenanceTaskPopup.cancelBubble = false;
        }
      };
    }
  }
})