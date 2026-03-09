import './dashboard.styl'
angular.module('vs-sms')
.directive('smsDashboard', function($http, $timeout, $state, env, alert) {
  return {
    template: require('./dashboard.html').default,
    scope: {},
    link: (scope) => {
      scope.yesno = ['No','Yes'];
      scope.stage = 'to';
      scope.receiveReplies = 'No';
      scope.from = 'Vitalspace';
      scope.when = new Date();
      scope.when = new Date(scope.when.getFullYear(), scope.when.getMonth(), scope.when.getDate(), scope.when.getHours() + 1);
      scope.numberlists = scope.list('main:numberlists', {}, (data) => {
        //console.log('numberlists', data);
      });
      scope.smstemplates = scope.list('main:smstemplates');
      scope.schedule = scope.list('main:schedule', {page:0,pageSize:0});
      scope.goToStage = (stage) => {
        scope.stage = stage;
      };
      scope.requirementsFulfilled = (stage) => {
        return true;
        switch(stage) {
          case 'to':
            return scope.numbers;
          case 'details':
            return scope.numbers;
        }
      };
      scope.selectList = () => {
        let list = scope.numberlists.items.find(l => l._id===scope.selectedList);
        scope.listName = '';
        scope.numbers = '';
        if(list) {
          scope.listName = list.name;
          scope.numbers = list.numbers;
        }
      }
      scope.selectTemplate = () => {
        let template = scope.smstemplates.items.find(t => t._id===scope.selectedTemplate);
        scope.message = '';
        if(template) {
          scope.message = template.text;
        }
      }
      scope.saveList = () => {
        if(!scope.listName) {
          return alert.log('Please input a list name');
        }
        if(!scope.numbers) {
          return alert.log('Please input some numbers');
        }
        let list = scope.numberlists.items.find(l => l.name===scope.listName);
        list = list || {};
        list.name = scope.listName;
        list.numbers = scope.numbers;
        scope.numberlists.save(list);
        alert.log('List saved');
      }
      scope.deleteList = () => {
        let list = scope.numberlists.items.find(l => l.name===scope.listName);
        if(list) {
          if(confirm('Are you sure you want to delete ' + list.name)) {
            scope.numberlists.delete(list);
            alert.log('List deleted');
            scope.seletedList = null;
            scope.listName = '';
            scope.numbers = '';
          }
        }
      }
      scope.confirm = () => {
        if(scope.numbers && scope.when && scope.from && scope.message) {
          let template = scope.smstemplates.items.find(l => l.text===scope.message.trim());
          if(!template) {
            scope.smstemplates.save({text:scope.message.trim()});
            alert.log('Template saved');
          }
          scope.schedule.save({
            selectedList: scope.selectedList,
            listName: scope.listName,
            numbers: scope.numbers,
            when: scope.when,
            from: scope.from,
            receiveReplies: scope.receiveReplies,
            selectedTemplate: scope.selectedTemplate,
            emailAddress: scope.emailAddress,
            message: scope.message
          });
          alert.log('Send scheduled');
        }
        $state.go('sms_schedule');
      }
      
    }
  }
})