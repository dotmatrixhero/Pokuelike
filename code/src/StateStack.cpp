#include "../include/StateStack.hpp"

#include <cassert>
#include <cstdio>

StateStack::StateStack()
{
}

// Updates Stack from top to bottom until a state returns false.
// In other words, a state returning true means process itself and
// fall through to the next state.
void StateStack::update()
{
    // for (auto iter = states.rbegin();
    //      iter != states.rend();
    //      ++iter)
    // {
    //     if (!(*iter)->update())
    //         break;
    // }
    states.back()->update();

    applyPendingStateChanges();
}

void StateStack::draw()
{
    // for (State::Ptr& state : states)
    // {
    //     state->draw();
    // }

    states.back()->draw();
}

// Works similarly to update()
void StateStack::handleInput(TCOD_key_t key)
{
    // for (auto iter = states.rbegin();
    //      iter != states.rend();
    //      ++iter)
    // {
    //     if (!(*iter)->handleInput(key))
    //         break;
    // }

    states.back()->handleInput(key);
}

void StateStack::pushState(States::ID stateId)
{
    changeList.push_back(PendingChange(Action::Push, stateId));
}

void StateStack::popState()
{
    changeList.push_back(PendingChange(Action::Pop));
}

void StateStack::clearStates()
{
    changeList.push_back(PendingChange(Action::Clear));
}

bool StateStack::isEmpty() const
{
    return states.empty();
}

void StateStack::applyPendingStateChanges()
{
    for (PendingChange& change : changeList)
    {
        switch (change.action)
        {
        case Action::Push:
            states.push_back(createState(change.stateId));
#if DEBUG
            printf("%d Push\n", states.size());
#endif
            break;
        case Action::Pop:
            states.pop_back();
#if DEBUG
            printf("%d Pop\n", states.size());
#endif
            break;
        case Action::Clear:
            states.clear();
#if DEBUG
            printf("%d Clear\n", states.size());
#endif
            break;
        };
    }

    changeList.clear();
}

State::Ptr StateStack::createState(States::ID stateId)
{
    auto index = stateFactory.find(stateId);

    assert(index != stateFactory.end());
    return index->second();
}


























