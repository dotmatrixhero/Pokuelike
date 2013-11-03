#ifndef _State_hpp_
#define _State_hpp_

#include "StateIdentifiers.hpp"
#include <memory>

class StateStack;

class State
{
    public:
    typedef std::unique_ptr<State> Ptr;

    public:
    State(StateStack& stateStack);
    virtual ~State();

    virtual bool draw() = 0;
    virtual bool update() = 0;
    virtual bool handleInput() = 0;

    protected:
    void requestStackPush(States::ID stateID);
    void requestStackPop();
    void requestStateClear();

    private:
    StateStack* stateStack;
};

#endif // _State_hpp
