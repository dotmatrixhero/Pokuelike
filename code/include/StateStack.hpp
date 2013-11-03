#ifndef _StateStack_hpp_
#define _StateStack_hpp_

#include "State.hpp"
#include "StateIdentifiers.hpp"

#include <vector>
#include <map>
#include <functional>

class StateStack
{
    public:
    explicit StateStack();

    void update();
    void draw();
    void handleInput();

    void pushState(States::ID stateId);
    void popState();
    void clearStates();

    bool isEmpty() const;

    private:
    enum class Action { Push, Pop, Clear };
    struct PendingChange
    {
        explicit PendingChange(Action action, States::ID stateId = States::None)
            : action(action), stateId(stateId)
        {
        }

        Action action;
        States::ID stateId;
    };


    public:
    template <typename T> void registerState(States::ID stateId);
    State::Ptr createState(States::ID stateId);
    void applyPendingStateChanges();

    private:
    std::vector<State::Ptr> states;
    std::vector<PendingChange> changeList;

    std::map<States::ID, std::function<State::Ptr()>> stateFactory;
};

template <typename T> void StateStack::registerState(States::ID stateId)
{
    stateFactory[stateId] = [this] ()
	{
            return State::Ptr(new T(*this));
	};
}

#endif // _StateStack_hpp_
