import './schedule.styl'
angular.module('vs-sms')
.directive('smsSchedule', function($http, alert) {
  return {
    template: require('./schedule.html').default,
    scope: {},
    link: (scope) => {
      scope.opts = {
        where: {
          when: {
            '$gt': new Date().toISOString()
          },
          processed: null
        },
        sort: 'when',
        sortDir: 'ASC'
      }
      scope.schedule = scope.list('main:schedule', scope.opts);
      scope.deleteEvent = (event) => {
        if(confirm('Are you sure you want to delete this event?')) {
          scope.schedule.delete(event);
          alert.log('event deleted');
        }
      }
    }
  }
})