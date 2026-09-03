#include "../include/State.hpp"
#include "../include/StateStack.hpp"

State::State(StateStack& stateStack)
    : stateStack(&stateStack)
{
}

State::~State()
{
}

void State::requestStackPush(States::ID stateID)
{
    stateStack->pushState(stateID);
}

void State::requestStackPop()
{
    stateStack->popState();
}

void State::requestStateClear()
{
    stateStack->clearStates();
}
